/**
 * Pipeline run orchestrator — sequences the deterministic modules for a run.
 *
 * This is the "Run pipeline" step: for each candidate site, run the modules the
 * vertical activates (site_fit + territory + lease always; others per vertical),
 * write module_results, update the candidate's composite score + verdict, then set
 * run status and confidence from the Truth Layer mix. AI is NOT involved here — the
 * report composer phrases later, from these results.
 *
 * Runs modules sequentially per site (safe under the Neon HTTP adapter — no deep
 * nested writes).
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { rollUpConfidence, type TruthLayer, type Confidence } from '@/lib/truth/truthLayer';
import { modulesForVertical } from './verticalConfig';
import { runSiteFit, persistSiteFit } from './siteFit';
import { runTerritoryGuard, persistTerritoryResult } from './territoryGuard';
import { runLeaseBenchmark, persistLeaseResult } from './leaseBenchmark';
import { inferCorridor } from './leaseMath';
import { runDaypart, runInformal, runHealthcare, runMall, runWhiteSpace, runLand } from './p2p3Modules';
import { competitorsNear } from '@/lib/places/poiCache';
import { siteCompositeFromModules, type ModuleScore } from './scorecard';
import type { ModuleKind } from '@prisma/client';

export interface RunResult {
  runId: string;
  status: 'ready' | 'failed' | 'analyzing';
  confidence: Confidence | null;
  /** false while more sites remain to analyze (client should re-invoke); true when the run is finalized. */
  complete: boolean;
  /** sites still awaiting analysis after this batch. */
  remaining: number;
  modulesRun: ModuleKind[];
  siteCount: number;
  perSite: Array<{ siteId: string; label: string; composite: number | null; verdict: string | null }>;
}

/**
 * Corridor used for the Lease Benchmark when the site's city/label doesn't map to a known
 * corridor. A central NCR corridor that always has comps, so Lease still returns an honest
 * corridor benchmark rather than nothing. (Every corridor in lease.real.json has 5–6 comps.)
 */
const DEFAULT_LEASE_CORRIDOR = 'Quezon City';

/**
 * Execute the pipeline for a run. Idempotent: module_results upsert per (site,module),
 * so re-running refreshes rather than duplicates.
 */
export async function runPipeline(runId: string): Promise<RunResult> {
  const run = await prisma.pipelineRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      sites: { select: { id: true, label: true, siteType: true, city: true, lat: true, lon: true } },
      franchisor: { select: { brandName: true, subCategory: true } },
      intake: { select: { sectionA: true, sectionH: true, sectionI: true, sectionJ: true } },
    },
  });
  // Category-conditional intake (QA v6): land parcel string → frontage/lot for the land screen.
  const parcel = parseParcel((run.intake?.sectionH as { landParcel?: string } | null)?.landParcel ?? null);
  // Per-unit capacity string → a unit count for the pop-per-unit / breakeven read.
  const units = parseUnits((run.intake?.sectionJ as { capacityUnits?: string } | null)?.capacityUnits ?? null);
  // Operator's target mall tier → compared against the nearest mall's actual tier.
  const targetMallTier = (run.intake?.sectionI as { mallTier?: string } | null)?.mallTier ?? null;
  // Concept text for the competitor discriminator: brand + sub-category + intake concept.
  const conceptText = [
    run.franchisor?.brandName,
    run.franchisor?.subCategory,
    (run.intake?.sectionA as { brand?: string; concept?: string } | null)?.concept,
    (run.intake?.sectionA as { brand?: string; concept?: string } | null)?.brand,
  ].filter(Boolean).join(' ');

  const modules = modulesForVertical(run.vertical);
  const allLayers: TruthLayer[] = [];
  let onGroundFlagged = false;

  const PIPELINE_BUDGET_MS = 5500;
  const pipelineStart = Date.now();

  // Resumable batch (serverless-safe): process only sites that have no
  // module_results yet, and stop once we're over the wall-clock budget. The
  // client re-invokes this route until `complete` — so a run with more sites
  // than fit in one function invocation still analyzes EVERY site instead of
  // timing out after ~2 heavy sites.
  const doneBeforeRows = await prisma.moduleResult.findMany({
    where: { pipelineRunId: runId },
    select: { candidateSiteId: true },
    distinct: ['candidateSiteId'],
  });
  const doneBefore = new Set(doneBeforeRows.map((r) => r.candidateSiteId));
  const pending = run.sites.filter((s) => !doneBefore.has(s.id));

  await prisma.pipelineRun.update({
    where: { id: runId },
    data: { status: 'analyzing', ...(doneBefore.size === 0 ? { startedAt: new Date() } : {}) },
  });

  const perSite: RunResult['perSite'] = [];
  let processedThisCall = 0;

  for (const site of pending) {
    // Budget guard: once at least one site is done this call and we're over
    // budget, stop and hand back to the client to re-invoke for the rest.
    if (processedThisCall > 0 && Date.now() - pipelineStart > PIPELINE_BUDGET_MS) break;
    processedThisCall++;

    try {
      // Concept-aware competitor count within the site-fit competition radius (800 m),
      // so the competition pillar reflects only genuine same-concept competitors.
      // Cache-through: warms this area from OSM on a miss (free, shared across all users),
      // then counts from the DB — so the competition pillar always has real data, not just
      // when a paid Places key is present.
      let conceptCompetitorCount: number | undefined;
      try {
        const comps = await competitorsNear(site.lat, site.lon, run.vertical, conceptText, { radiusM: 800, max: 20 });
        conceptCompetitorCount = comps.length;
      } catch { conceptCompetitorCount = undefined; }

      // --- site_fit (also sets the candidate composite/verdict) --------------
      if (modules.includes('site_fit')) {
        const fit = await runSiteFit(site.id, conceptCompetitorCount);
        await persistSiteFit(runId, site.id, fit);
        allLayers.push(fit.truthLayer);
        await prisma.candidateSite.update({
          where: { id: site.id },
          data: {
            compositeScore: fit.composite ?? undefined,
            verdict: fit.verdict === 'insufficient' ? undefined : (fit.verdict as 'go' | 'caution' | 'nogo'),
          },
        });
        perSite.push({ siteId: site.id, label: site.label, composite: fit.composite, verdict: fit.verdict });
      }

      // --- territory ---------------------------------------------------------
      if (modules.includes('territory')) {
        const terr = await runTerritoryGuard(site.id, run.franchisorId, run.exclusivityRadiusM, run.vertical, conceptText, run.franchisor?.brandName ?? undefined);
        await persistTerritoryResult(runId, terr);
        allLayers.push(terr.moduleTruthLayer);
        if (terr.flags.some((f) => f.includes('cannibalization'))) onGroundFlagged = onGroundFlagged || false;
      }

      // --- lease (ALWAYS produces a result) ----------------------------------
      // Lease is a core module: every intake must yield a Lease Benchmark. We infer the
      // corridor from the site city/label; when nothing matches (missing/foreign city),
      // fall back to a central NCR corridor that has comps so the module still returns an
      // honest corridor benchmark instead of silently producing nothing. The benchmark's
      // own verdict (corridor_benchmark / insufficient_data) already carries the caveat.
      if (modules.includes('lease')) {
        const corridor = inferCorridor(site.city, site.label) ?? DEFAULT_LEASE_CORRIDOR;
        const lease = await runLeaseBenchmark({
          candidateSiteId: site.id,
          format: site.siteType ?? 'inline',
          corridor,
          siteTerms: {}, // no asking terms at pipeline time; benchmark yields the corridor read
        });
        await persistLeaseResult(runId, lease);
        allLayers.push(lease.moduleTruthLayer);
        if (lease.flags.includes('secondary_terms_over_market')) onGroundFlagged = true;
      }

      // --- P2/P3 modules (vertical-activated) --------------------------------
      if (modules.includes('daypart')) { await runDaypart(runId, site.id, run.vertical); allLayers.push('projected'); }
      // Informal runs for its listed verticals, AND for any per-unit format that supplied
      // a units count (e.g. a water-refilling station filed under convenience) so the
      // pop-per-unit / breakeven read is produced wherever it's meaningful.
      if (modules.includes('informal') || units != null) {
        await runInformal(runId, site.id, run.vertical, units);
        allLayers.push('assumed');
        onGroundFlagged = true; // informal capture always advises the on-ground check honesty flag
      }
      if (modules.includes('healthcare')) { await runHealthcare(runId, site.id); allLayers.push('projected'); }
      if (modules.includes('mall')) { await runMall(runId, site.id, targetMallTier); allLayers.push('assumed'); }
      if (modules.includes('whitespace')) { await runWhiteSpace(runId, site.id, run.franchisorId); allLayers.push('projected'); }
      if (modules.includes('land')) { await runLand(runId, site.id, run.vertical, parcel); allLayers.push('assumed'); }

      // --- Reconcile the stored site composite with ALL modules --------------
      // site_fit set a provisional composite above, but that read ignores territory
      // cannibalization, lease, daypart, etc. Recompute the stored composite/verdict
      // from every module that ran (the SAME weighted math the scorecard uses), so the
      // dashboard headline, the ranked shortlist, and the scorecard can never disagree
      // (no more "97 GO" on the dashboard vs "55.1 CAUTION" on the scorecard for one site).
      const siteRows = await prisma.moduleResult.findMany({
        where: { candidateSiteId: site.id },
        select: { module: true, score: true, truthLayer: true },
      });
      if (siteRows.length) {
        const moduleScores: ModuleScore[] = siteRows.map((r) => ({
          module: r.module,
          score: r.score != null ? Number(r.score) : null,
          truthLayer: r.truthLayer as TruthLayer,
          note: '',
        }));
        const { composite, band } = siteCompositeFromModules(moduleScores);
        if (composite != null) {
          await prisma.candidateSite.update({
            where: { id: site.id },
            data: {
              compositeScore: composite,
              verdict: band === 'insufficient' ? undefined : (band as 'go' | 'caution' | 'nogo'),
            },
          });
          // Keep the returned perSite summary consistent with what we stored.
          const ps = perSite.find((p) => p.siteId === site.id);
          if (ps) { ps.composite = composite; ps.verdict = band; }
        }
      }
    } catch (err) {
      // Fault isolation: one failed site must not stall the whole run. Persist a
      // sentinel territory result so the site counts as processed and the batch
      // makes forward progress instead of retrying the same site every call.
      const detail = String((err as { message?: string })?.message ?? err);
      await prisma.moduleResult.upsert({
        where: { site_module_key: { candidateSiteId: site.id, module: 'territory' } },
        create: {
          candidateSiteId: site.id,
          pipelineRunId: runId,
          module: 'territory',
          score: null,
          payload: { error: 'pipeline_site_error', detail } as object,
          truthLayer: 'projected',
          flags: ['pipeline_error'],
        },
        update: {
          payload: { error: 'pipeline_site_error', detail } as object,
          truthLayer: 'projected',
          flags: ['pipeline_error'],
        },
      });
    }
  }

  // After this batch, how many sites still have no module_results at all?
  const doneAfterRows = await prisma.moduleResult.findMany({
    where: { pipelineRunId: runId },
    select: { candidateSiteId: true },
    distinct: ['candidateSiteId'],
  });
  const doneAfter = new Set(doneAfterRows.map((r) => r.candidateSiteId));
  const remaining = run.sites.filter((s) => !doneAfter.has(s.id)).length;

  if (remaining > 0) {
    // Still sites to analyze — stay 'analyzing' and let the client re-invoke.
    return {
      runId,
      status: 'analyzing',
      confidence: null,
      complete: false,
      remaining,
      modulesRun: modules,
      siteCount: run.sites.length,
      perSite,
    };
  }

  // Every site analyzed — finalize. Roll confidence up from EVERY module_result's
  // truth layer read back from the DB (so it reflects all batches, not just this call).
  const allRows = await prisma.moduleResult.findMany({
    where: { pipelineRunId: runId },
    select: { module: true, truthLayer: true, flags: true },
  });
  const finalLayers = allRows.map((r) => r.truthLayer as TruthLayer);
  const finalOnGround = allRows.some((r) =>
    r.module === 'informal' ||
    (r.flags ?? []).includes('secondary_terms_over_market') ||
    (r.flags ?? []).includes('pipeline_error'),
  );
  const confidence = rollUpConfidence(finalLayers, { onGroundCheckFlagged: finalOnGround });
  await prisma.pipelineRun.update({
    where: { id: runId },
    data: { status: 'ready', confidence, finishedAt: new Date() },
  });

  // Rebuild perSite from the DB so the finalizing call returns every site, even
  // if it processed zero pending sites itself.
  const finalSiteRows = await prisma.candidateSite.findMany({
    where: { id: { in: run.sites.map((s) => s.id) } },
    select: { id: true, label: true, compositeScore: true, verdict: true },
  });
  const perSiteFinal = finalSiteRows.map((s) => ({
    siteId: s.id,
    label: s.label,
    composite: s.compositeScore != null ? Number(s.compositeScore) : null,
    verdict: (s.verdict as string | null) ?? null,
  }));

  return {
    runId,
    status: 'ready',
    confidence,
    complete: true,
    remaining: 0,
    modulesRun: modules,
    siteCount: run.sites.length,
    perSite: perSiteFinal,
  };
}

/**
 * Parse a free/dropdown land-parcel string into a frontage (m) and lot area (sqm)
 * the land screen can use. Reads explicit "≥ 1,000 sqm" / "20 m frontage" numbers
 * where present; otherwise falls back to the band implied by the dropdown wording.
 * Returns nulls when nothing is supplied (module then screens on traffic + zoning).
 */
export function parseParcel(s: string | null): { frontageM: number | null; lotAreaSqm: number | null } {
  if (!s) return { frontageM: null, lotAreaSqm: null };
  const t = s.toLowerCase().replace(/,/g, '');
  const sqmMatch = t.match(/(\d{3,5})\s*(?:sqm|sq\.?\s*m|square)/);
  const frontMatch = t.match(/(\d{1,3})\s*m(?:\s*frontage|\s+frontage|-?frontage)?/);
  let lotAreaSqm = sqmMatch ? Number(sqmMatch[1]) : null;
  let frontageM = frontMatch ? Number(frontMatch[1]) : null;
  // Band fallbacks from the dropdown phrasing when no explicit number matched.
  if (lotAreaSqm == null) {
    if (t.includes('≥ 1000') || t.includes('>= 1000') || t.includes('corner lot')) lotAreaSqm = 1000;
    else if (t.includes('1000–3000') || t.includes('1000-3000') || t.includes('large format')) lotAreaSqm = 1500;
    else if (t.includes('500–1000') || t.includes('500-1000') || t.includes('inline lot')) lotAreaSqm = 750;
    else if (t.includes('< 500') || t.includes('<500') || t.includes('small lot')) lotAreaSqm = 400;
  }
  if (frontageM == null) {
    if (t.includes('corner') || t.includes('two-road') || t.includes('two frontage')) frontageM = 35;
    else if (t.includes('inline lot')) frontageM = 20;
  }
  return { frontageM, lotAreaSqm };
}

/**
 * Parse the per-unit capacity intake string ("5–8 units", "16+ units", "3 chairs")
 * into a representative unit count for the capacity read. Uses the low end of a band
 * (conservative) or the explicit number when typed manually.
 */
export function parseUnits(s: string | null): number | null {
  if (!s) return null;
  const t = s.toLowerCase().replace(/,/g, '');
  const m = t.match(/(\d{1,3})/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// inferCorridor now lives in ./leaseMath (pure, client-safe) so the Lease Benchmark
// tool and this pipeline resolve a site to the SAME corridor. Re-exported here to
// preserve the orchestrator's public surface for existing importers.
export { inferCorridor } from './leaseMath';
