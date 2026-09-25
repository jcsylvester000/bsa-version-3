/**
 * Pipeline run orchestrator — sequences the deterministic modules for a run.
 *
 * This is the "Run pipeline" step: for each candidate site, run the modules the
 * vertical activates (site_fit + territory + lease + daypart + whitespace always; others
 * per vertical), write module_results, update the candidate's composite score + verdict,
 * then set run status and evidence confidence. AI is NOT involved here — the Analysis
 * Report is generated per site afterwards (POST /api/analysis-report).
 *
 * Batch 3 integrity rules:
 *  - A site is DONE only when `candidate_site.analyzed_at` is set (after every module was
 *    attempted). Resume = process sites where it is NULL. (Before, any single module row
 *    marked a site done, so a killed invocation left it half-analysed forever.)
 *  - Each module is isolated: one failing module is recorded in `pipeline_error` and the
 *    others still run. No sentinel rows overwrite real results.
 *  - An unexpected failure outside a site marks the run `failed` (never stuck `analyzing`).
 *  - `refresh: true` clears the markers so a finished run is fully recomputed (e.g. after
 *    reference data is updated).
 *
 * Runs modules sequentially per site (safe under the Neon HTTP adapter — no deep
 * nested writes).
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { TruthLayer, Confidence } from '@/lib/truth/truthLayer';
import { modulesForVertical } from './verticalConfig';
import { runSiteFit, persistSiteFit } from './siteFit';
import { runTerritoryGuard, persistTerritoryResult } from './territoryGuard';
import { runLeaseBenchmark, persistLeaseResult } from './leaseBenchmark';
import { inferCorridor } from './leaseMath';
import { runDaypart, runInformal, runHealthcare, runMall, runWhiteSpace, runLand } from './p2p3Modules';
import { competitorsNear } from '@/lib/places/poiCache';
import { siteEvidenceScore, runEvidenceConfidence } from './scorecard';
import { recomputeSiteComposite } from './scorecardServer';
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
  perSite: Array<{ siteId: string; label: string; composite: number | null; verdict: string | null; error?: string | null }>;
}

/**
 * Corridor used for the Lease Benchmark when the site's city/label doesn't map to a known
 * corridor. A central NCR corridor that always has comps, so Lease still returns an honest
 * corridor benchmark rather than nothing. (Every corridor in lease.real.json has 5–6 comps.)
 */
const DEFAULT_LEASE_CORRIDOR = 'Quezon City';

/** Wall-clock budget per invocation (serverless-safe); checked between sites. */
const PIPELINE_BUDGET_MS = 5500;

/**
 * Execute one time-boxed slice of the pipeline for a run. Call repeatedly until
 * `complete`. Module rows upsert per (site, module), so re-running refreshes rather
 * than duplicates.
 */
export async function runPipeline(runId: string, opts: { refresh?: boolean } = {}): Promise<RunResult> {
  try {
    return await runPipelineSlice(runId, opts);
  } catch (err) {
    // Anything outside the per-site isolation (DB outage, bad run) → the run is FAILED,
    // not left looking "analyzing" forever. The client can retry (refresh or resume).
    console.error(`[pipeline] run ${runId} failed:`, err);
    await prisma.pipelineRun
      .update({ where: { id: runId }, data: { status: 'failed', finishedAt: new Date() } })
      .catch(() => undefined);
    throw err;
  }
}

async function runPipelineSlice(runId: string, opts: { refresh?: boolean }): Promise<RunResult> {
  // Read the run and its relations as SEPARATE flat queries — never findUniqueOrThrow + include.
  // Under the Neon HTTP adapter both open an implicit transaction, which HTTP mode rejects with
  // "Transactions are not supported in HTTP mode" (audit F-01). Plain findUnique + null check +
  // separate reads carry no transaction.
  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    select: { id: true, vertical: true, franchisorId: true, intakeSubmissionId: true, exclusivityRadiusM: true },
  });
  if (!run) throw new Error(`Run ${runId} not found`);
  const sites = await prisma.candidateSite.findMany({
    where: { pipelineRunId: runId },
    select: { id: true, label: true, siteType: true, city: true, lat: true, lon: true, analyzedAt: true },
  });
  const franchisor = run.franchisorId
    ? await prisma.franchisor.findUnique({ where: { id: run.franchisorId }, select: { brandName: true, subCategory: true } })
    : null;
  const intake = run.intakeSubmissionId
    ? await prisma.intakeSubmission.findUnique({ where: { id: run.intakeSubmissionId }, select: { sectionA: true, sectionH: true, sectionI: true, sectionJ: true } })
    : null;
  // Category-conditional intake (QA v6): land parcel string → frontage/lot for the land screen.
  const parcel = parseParcel((intake?.sectionH as { landParcel?: string } | null)?.landParcel ?? null);
  // Per-unit capacity string → a unit count for the pop-per-unit / breakeven read.
  const units = parseUnits((intake?.sectionJ as { capacityUnits?: string } | null)?.capacityUnits ?? null);
  // Operator's target mall tier → compared against the nearest mall's actual tier.
  const targetMallTier = (intake?.sectionI as { mallTier?: string } | null)?.mallTier ?? null;
  // Concept text for the competitor discriminator: brand + sub-category + intake concept.
  const conceptText = [
    franchisor?.brandName,
    franchisor?.subCategory,
    (intake?.sectionA as { brand?: string; concept?: string } | null)?.concept,
    (intake?.sectionA as { brand?: string; concept?: string } | null)?.brand,
  ].filter(Boolean).join(' ');

  const modules = modulesForVertical(run.vertical);
  // Informal also runs for any per-unit format that supplied a unit count.
  const expectedModules: ModuleKind[] = units != null && !modules.includes('informal') ? [...modules, 'informal'] : modules;

  // Refresh = recompute a finished run from scratch (keeps old rows until overwritten).
  if (opts.refresh) {
    await prisma.candidateSite.updateMany({
      where: { pipelineRunId: runId },
      data: { analyzedAt: null, pipelineError: null },
    });
    // Cached AI write-ups describe the OLD figures — drop them so they're regenerated.
    await prisma.moduleResult.deleteMany({ where: { pipelineRunId: runId, module: 'analysis' } });
    for (const s of sites) s.analyzedAt = null;
  }

  const pending = sites.filter((s) => s.analyzedAt == null);
  const startedFresh = pending.length === sites.length;
  await prisma.pipelineRun.update({
    where: { id: runId },
    data: { status: 'analyzing', ...(startedFresh ? { startedAt: new Date(), finishedAt: null } : {}) },
  });

  const pipelineStart = Date.now();
  const perSite: RunResult['perSite'] = [];
  let processedThisCall = 0;

  for (const site of pending) {
    // Budget guard: once at least one site is done this call and we're over
    // budget, stop and hand back to the client to re-invoke for the rest.
    if (processedThisCall > 0 && Date.now() - pipelineStart > PIPELINE_BUDGET_MS) break;
    processedThisCall++;

    const errors: string[] = [];
    /** Run one module in isolation: a failure is recorded, the remaining modules still run. */
    const attempt = async (name: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (err) {
        const msg = String((err as { message?: string })?.message ?? err).slice(0, 200);
        console.error(`[pipeline] run=${runId} site=${site.id} module=${name}:`, msg);
        errors.push(`${name}: ${msg}`);
      }
    };

    // Concept-aware competitor count within the site-fit competition radius (800 m).
    // Cache-through: warms this area from OSM on a miss, then counts from the DB.
    let conceptCompetitorCount: number | undefined;
    try {
      const comps = await competitorsNear(site.lat, site.lon, run.vertical, conceptText, { radiusM: 800, max: 40 });
      conceptCompetitorCount = comps.length;
    } catch { conceptCompetitorCount = undefined; }

    if (modules.includes('site_fit')) {
      await attempt('site_fit', async () => {
        const fit = await runSiteFit(site.id, conceptCompetitorCount);
        await persistSiteFit(runId, site.id, fit);
      });
    }
    if (modules.includes('territory')) {
      await attempt('territory', async () => {
        const terr = await runTerritoryGuard(
          site.id, run.franchisorId, run.exclusivityRadiusM, run.vertical, conceptText,
          franchisor?.brandName ?? undefined, run.intakeSubmissionId,
        );
        await persistTerritoryResult(runId, terr);
      });
    }
    // Lease is a core module: every intake yields a Lease Benchmark. Corridor inferred from
    // the site city/label, else a central NCR corridor with comps. With no asking rent at
    // pipeline time the result is a corridor read (unscored → it doesn't move the composite
    // until the user enters an asking rent on the Lease tab).
    if (modules.includes('lease')) {
      await attempt('lease', async () => {
        const inferred = inferCorridor(site.city, site.label);
        const corridor = inferred ?? DEFAULT_LEASE_CORRIDOR;
        const lease = await runLeaseBenchmark({ candidateSiteId: site.id, format: site.siteType ?? 'inline', corridor, siteTerms: {} });
        if (!inferred) {
          // Never silent: the comps come from a DIFFERENT area than the site, so the read is a
          // proxy (Projected) and the UI/AI say so.
          lease.flags.push('corridor_default_fallback');
          lease.moduleTruthLayer = 'projected';
        }
        await persistLeaseResult(runId, lease);
      });
    }
    if (modules.includes('daypart')) await attempt('daypart', () => runDaypart(runId, site.id, run.vertical));
    if (expectedModules.includes('informal')) await attempt('informal', () => runInformal(runId, site.id, run.vertical, units, conceptCompetitorCount));
    if (modules.includes('healthcare')) await attempt('healthcare', () => runHealthcare(runId, site.id));
    if (modules.includes('mall')) await attempt('mall', () => runMall(runId, site.id, targetMallTier));
    if (modules.includes('whitespace')) {
      await attempt('whitespace', () =>
        runWhiteSpace(runId, site.id, run.franchisorId, run.vertical, conceptText, franchisor?.brandName ?? undefined, run.intakeSubmissionId),
      );
    }
    if (modules.includes('land')) await attempt('land', () => runLand(runId, site.id, run.vertical, parcel));

    // Composite from EVERY module that scored (same math as the scorecard), then mark done.
    let composite: number | null = null;
    let band: string | null = null;
    await attempt('composite', async () => {
      const r = await recomputeSiteComposite(site.id);
      composite = r.composite;
      band = r.band === 'insufficient' ? null : r.band;
    });
    const pipelineError = errors.length ? errors.join(' | ').slice(0, 1000) : null;
    await prisma.candidateSite.update({
      where: { id: site.id },
      data: { analyzedAt: new Date(), pipelineError },
    });
    perSite.push({ siteId: site.id, label: site.label, composite, verdict: band, error: pipelineError });
  }

  const remaining = await prisma.candidateSite.count({ where: { pipelineRunId: runId, analyzedAt: null } });
  if (remaining > 0) {
    return {
      runId, status: 'analyzing', confidence: null, complete: false, remaining,
      modulesRun: expectedModules, siteCount: sites.length, perSite,
    };
  }

  // Every site analysed — finalize from the DB (reflects every slice, not just this call).
  const [siteRows, rows] = await Promise.all([
    prisma.candidateSite.findMany({
      where: { pipelineRunId: runId },
      select: { id: true, label: true, compositeScore: true, verdict: true, pipelineError: true },
    }),
    prisma.moduleResult.findMany({
      where: { pipelineRunId: runId, module: { not: 'analysis' } }, // AI narrative is not evidence
      select: { candidateSiteId: true, module: true, score: true, truthLayer: true, flags: true },
    }),
  ]);
  const siteEvidence = siteRows.map((s) =>
    siteEvidenceScore(
      rows.filter((r) => r.candidateSiteId === s.id)
        .map((r) => ({ module: r.module, score: r.score != null ? Number(r.score) : null, truthLayer: r.truthLayer as TruthLayer })),
      expectedModules,
    ),
  );
  const onGround =
    rows.some((r) => r.module === 'informal' || (r.flags ?? []).includes('secondary_terms_over_market')) ||
    siteRows.some((s) => s.pipelineError != null);
  const { confidence } = runEvidenceConfidence(siteEvidence, { onGroundCheckFlagged: onGround });

  // A run where EVERY site failed outright (no module produced anything) is failed, not ready.
  const nothingProduced = rows.length === 0;
  const status: RunResult['status'] = nothingProduced ? 'failed' : 'ready';
  await prisma.pipelineRun.update({
    where: { id: runId },
    data: { status, confidence: nothingProduced ? null : confidence, finishedAt: new Date() },
  });

  return {
    runId,
    status,
    confidence: nothingProduced ? null : confidence,
    complete: true,
    remaining: 0,
    modulesRun: expectedModules,
    siteCount: sites.length,
    perSite: siteRows.map((s) => ({
      siteId: s.id,
      label: s.label,
      composite: s.compositeScore != null ? Number(s.compositeScore) : null,
      verdict: (s.verdict as string | null) ?? null,
      error: s.pipelineError,
    })),
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
