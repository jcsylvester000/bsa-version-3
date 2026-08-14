/**
 * Report composer — assembles the 9-section Site Intelligence Report from a run's
 * module_result rows via retrieve-then-generate.
 *
 * Discipline (AI Systems Engineer + Truth Layer):
 *  - Deterministic code gathers the facts and their Truth Layer labels from
 *    module_result. The AI only PHRASES each section from those grounded facts.
 *  - Run confidence is computed from the Truth Layer mix, not asserted by the model.
 *  - A section with no supporting module data is rendered as "not assessed", never
 *    invented.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { rollUpConfidence, type TruthLayer, type Confidence } from '@/lib/truth/truthLayer';
import { REPORT_SECTIONS, type SectionDef } from './reportSections';
import type { ModuleKind } from '@prisma/client';

/**
 * A single render-ready metric for the structured (AI-free) report. The UI turns these
 * into score bars, verdict pills, stat rows and mini charts — no prose, no AI.
 */
export interface ReportMetric {
  siteLabel: string;
  label: string;                 // e.g. "Max overlap", "Corridor rent"
  /** 0–100 score for a bar, when the metric is scoreable. */
  score?: number | null;
  /** A raw display value (with unit) when it isn't a 0–100 score. */
  value?: string;
  /** Verdict word to render as a pill (adds / caution / redistributes / …). */
  verdict?: string;
  truthLayer: TruthLayer;
  /** Optional min–median–max range chart (used by lease corridor benchmark). */
  range?: { min: number; median: number; max: number; n: number };
  /** Direction hint for coloring a bar: higher-is-better (default) or worse. */
  higherIsBetter?: boolean;
  note?: string;
}

export interface ComposedSection {
  id: string;
  number: number;
  title: string;
  text: string;
  truthLayers: TruthLayer[];
  grounded: string[];
  assessed: boolean;
  /** Structured, AI-free metrics the UI renders as visuals. */
  metrics: ReportMetric[];
}

export interface ComposedReport {
  runId: string;
  brandName: string;
  confidence: Confidence;
  onGroundCheckFlagged: boolean;
  sections: ComposedSection[];
  truthLayerMix: Record<TruthLayer, number>;
  generatedAtNote: string;
}

interface ModuleRow {
  module: ModuleKind;
  score: number | null;
  truthLayer: TruthLayer;
  flags: string[];
  payload: unknown;
  siteLabel: string;
}

/** Turn a module_result row into a few plain grounded fact lines for the AI. */
function factsForModule(row: ModuleRow): string[] {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  switch (row.module) {
    case 'territory': {
      const own = (p.ownOutletOverlapPct as number) ?? 0;
      const sat = (p.competitiveSaturationPct as number) ?? 0;
      const cnt = (p.competitorCount as number) ?? 0;
      const mix = p.competitorMix as { direct: number; adjacent: number } | undefined;
      // Saturation is tier-weighted: direct rivals count in full, adjacent formats at a
      // reduced weight. Spell that out so the narrative can't imply a gym was counted.
      const mixText = mix
        ? `${mix.direct} direct same-concept competitor(s) + ${mix.adjacent} adjacent format(s)`
        : `${cnt} same-concept competitor(s)`;
      const src = p.headlineSource === 'competitive'
        ? `driven by competitive saturation: ${mixText} in the catchment → ${sat}% modelled saturation (Projected)`
        : `driven by own-branch trade-area overlap ${own}% (Verified)`;
      return [
        `[${row.siteLabel}] Territory: headline overlap ${p.maxOverlapPct ?? '?'}%, verdict "${p.verdict ?? '?'}" — ${src}. Own-branch overlap ${own}% (Verified); competitive saturation ${sat}% from ${mixText}${p.conceptLabel ? `, matched against ${p.conceptLabel}` : ''} (Projected); est. monthly cannibalization ₱${(p.totalCannibalizedPhp as number)?.toLocaleString?.() ?? '?'} (Projected).`,
      ];
    }
    case 'lease': {
      const st = p.baseRentStats as { median?: number; min?: number; max?: number; n?: number } | undefined;
      if (p.verdict === 'corridor_benchmark' && st?.median != null) {
        return [
          `[${row.siteLabel}] Lease: no asking rent supplied yet — corridor benchmark is ₱${Math.round(st.min ?? 0).toLocaleString()}–₱${Math.round(st.max ?? 0).toLocaleString()}/sqm, median ₱${Math.round(st.median).toLocaleString()} across ${st.n ?? 0} comparable leases (Verified comps; Assumed fair-range).`,
        ];
      }
      return [
        `[${row.siteLabel}] Lease: asking base rent at the ${p.baseRentPercentile ?? '?'}th percentile of the corridor (Assumed), verdict "${p.verdict ?? '?'}", negotiating room ₱${p.negotiatingRoomPhpSqm ?? '?'}/sqm.`,
      ];
    }
    case 'site_fit':
      if (row.score == null) {
        return [`[${row.siteLabel}] Site fit: not scored — the demographic/population layer for this catchment is not loaded, so the demand pillar (the primary driver) can't be measured. Competition headroom is shown in the site detail; load a demographic layer to publish a full Site-Fit score.`];
      }
      return [`[${row.siteLabel}] Site fit: composite ${row.score}/100, verdict "${p.verdict ?? '?'}" (${row.truthLayer}).`];
    case 'daypart':
      if (p.noCatchmentData) {
        return [`[${row.siteLabel}] Daypart: daytime/residential split not derived — the demographic (daytime-population) layer isn't loaded for this catchment, so no daypart curve is published (seasonality is modelled from corridor data and still shown).`];
      }
      return [`[${row.siteLabel}] Daypart: ${p.windowMatchPct ?? '?'}% of demand in the target window, ${p.daytimeShare ?? '?'}% daytime (Projected).`];
    case 'informal':
      return [`[${row.siteLabel}] Competition: ${p.digitalCount ?? '?'} digital competitors (Verified) + ~${p.estimatedInformal ?? '?'} informal (Assumed)${p.onGroundCheckAdvised ? '; on-ground check advised' : ''}.`];
    case 'mall':
      return [`[${row.siteLabel}] Mall: ${p.mallName ?? 'nearest mall'} score ${row.score ?? 'n/a'}/100, verdict "${p.verdict ?? '?'}" (tier Verified, footfall Assumed).`];
    case 'healthcare': {
      const cat = p.catchmentNote ? ` Catchment: ${p.catchmentNote}.` : '';
      const prox = p.proximityScore != null ? `proximity ${p.proximityScore}` : '';
      const catS = p.catchmentScore != null ? `, catchment ${p.catchmentScore}` : '';
      return [`[${row.siteLabel}] Healthcare fit: composite ${row.score ?? 'n/a'}/100 (${prox}${catS}), verdict "${p.verdict ?? '?'}" — facilities Verified, catchment Projected.${cat}`];
    }
    case 'whitespace':
      return [`[${row.siteLabel}] White-space: top gap opportunity score ${row.score ?? 'n/a'} (density Verified, ranking Projected).`];
    default:
      return [`[${row.siteLabel}] ${row.module}: score ${row.score ?? 'n/a'} (${row.truthLayer}).`];
  }
}

/**
 * Structured, render-ready metrics from a module_result row — the AI-free report. The
 * numbers here come straight from the persisted payload; the UI draws bars/pills/charts.
 */
function metricsForModule(row: ModuleRow): ReportMetric[] {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const base = { siteLabel: row.siteLabel, truthLayer: row.truthLayer };
  switch (row.module) {
    case 'site_fit':
      return [{ ...base, label: 'Site fit composite', score: row.score ?? null, verdict: String(p.verdict ?? ''), higherIsBetter: true }];
    case 'territory': {
      const overlap = num(p.maxOverlapPct) ?? 0;
      const cannib = num(p.totalCannibalizedPhp) ?? 0;
      const sat = num(p.competitiveSaturationPct) ?? 0;
      const cnt = num(p.competitorCount) ?? 0;
      // When the headline comes from competitor saturation (a new brand with no own
      // outlets, or a corridor denser in rivals than in own branches), say so — this is
      // exactly the case that used to read as a false 0%.
      const mx = p.competitorMix as { direct: number; adjacent: number } | undefined;
      const note = p.headlineSource === 'competitive'
        ? `${mx ? `${mx.direct} direct + ${mx.adjacent} adjacent` : `${cnt} same-concept`} competitors nearby → ${sat}% competitive saturation (Projected)`
        : cannib > 0
          ? `~₱${cannib.toLocaleString()}/mo cannibalized (Projected)`
          : sat > 0
            ? `no own-branch overlap; ${cnt} competitors nearby → ${sat}% saturation (Projected)`
            : 'Peso impact not estimated — no branch sales on file';
      return [{
        ...base,
        label: p.headlineSource === 'competitive' ? 'Cannibalization risk (competitive)' : 'Max trade-area overlap',
        score: overlap, verdict: String(p.verdict ?? ''),
        higherIsBetter: false, // more overlap/saturation = worse (cannibalization)
        note,
      }];
    }
    case 'lease': {
      const st = p.baseRentStats as { median?: number; min?: number; max?: number; n?: number } | undefined;
      if (p.verdict === 'corridor_benchmark' && st?.median != null) {
        return [{
          ...base, label: 'Corridor rent (₱/sqm)', verdict: 'corridor benchmark',
          range: { min: Math.round(st.min ?? 0), median: Math.round(st.median), max: Math.round(st.max ?? 0), n: st.n ?? 0 },
          note: 'Enter your asking rent to benchmark against this spread',
        }];
      }
      return [{
        ...base, label: 'Base rent vs corridor', score: num(p.baseRentPercentile) ?? null, verdict: String(p.verdict ?? ''),
        higherIsBetter: false, note: num(p.negotiatingRoomPhpSqm) != null ? `Room to median ₱${Number(p.negotiatingRoomPhpSqm).toLocaleString()}/sqm` : undefined,
      }];
    }
    case 'daypart':
      return [{ ...base, label: 'Peak-window demand captured', score: num(p.windowMatchPct) ?? null, higherIsBetter: true, note: `${num(p.daytimeShare) ?? '?'}% daytime catchment` }];
    case 'informal': {
      const total = num(p.totalEstimated) ?? 0;
      return [{ ...base, label: 'Competition intensity', score: num(p.competitionScore) ?? null, higherIsBetter: true, note: `${total} est. competitors nearby${p.onGroundCheckAdvised ? ' · on-ground check advised' : ''}` }];
    }
    case 'mall':
      return [{ ...base, label: `Mall fit — ${String(p.mallName ?? 'nearest mall')}`, score: row.score ?? null, verdict: String(p.verdict ?? ''), higherIsBetter: true }];
    case 'healthcare':
      return [{ ...base, label: 'Healthcare fit', score: row.score ?? null, verdict: String(p.verdict ?? ''), higherIsBetter: true, note: p.catchmentNote ? String(p.catchmentNote) : undefined }];
    case 'whitespace':
      return [{ ...base, label: 'Top white-space gap', score: row.score ?? null, higherIsBetter: true }];
    case 'land': {
      const corr = p.corridor ? String(p.corridor) : null;
      const band = String(p.trafficBand ?? 'unknown').replace('_', ' ');
      const aadt = num(p.aadtRef);
      const note = corr
        ? `${corr} corridor · ${band} traffic${aadt ? ` (~${aadt.toLocaleString()} AADT)` : ''} · seasonal range modelled (Projected)`
        : undefined;
      return [{ ...base, label: 'Land & traffic screen', score: row.score ?? null, verdict: String(p.verdict ?? ''), higherIsBetter: true, note }];
    }
    default:
      return [{ ...base, label: row.module, score: row.score ?? null }];
  }
}

/** Compose the full report for a run. Does NOT persist — the API/route does that. */
export async function composeReport(runId: string): Promise<ComposedReport> {
  const run = await prisma.pipelineRun.findUniqueOrThrow({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } } },
  });

  const rows = await prisma.moduleResult.findMany({
    where: { pipelineRunId: runId },
    include: { site: { select: { label: true } } },
  });

  const moduleRows: ModuleRow[] = rows.map((r) => ({
    module: r.module,
    score: r.score != null ? Number(r.score) : null,
    truthLayer: r.truthLayer,
    flags: r.flags,
    payload: r.payload,
    siteLabel: r.site.label,
  }));

  // Group facts + truth layers by module for quick section lookup.
  const byModule = new Map<ModuleKind, ModuleRow[]>();
  for (const r of moduleRows) {
    const arr = byModule.get(r.module) ?? [];
    arr.push(r);
    byModule.set(r.module, arr);
  }

  const onGroundCheckFlagged = moduleRows.some((r) =>
    r.flags.some((f) => f.includes('on_ground') || f === 'secondary_terms_over_market'),
  );

  // Run confidence from the Truth Layer mix of all module outputs.
  const allLayers = moduleRows.map((r) => r.truthLayer);
  const confidence = rollUpConfidence(allLayers, { onGroundCheckFlagged });

  const sections: ComposedSection[] = [];
  for (const def of REPORT_SECTIONS) {
    sections.push(await composeSection(def, byModule, runId, run.franchisor.brandName, { confidence, allLayers }));
  }

  const truthLayerMix: Record<TruthLayer, number> = { verified: 0, assumed: 0, projected: 0 };
  for (const l of allLayers) truthLayerMix[l] += 1;

  return {
    runId,
    brandName: run.franchisor.brandName,
    confidence,
    onGroundCheckFlagged,
    sections,
    truthLayerMix,
    generatedAtNote: 'Composed from deterministic module results; AI phrased each section from grounded, classified data.',
  };
}

async function composeSection(
  def: SectionDef,
  byModule: Map<ModuleKind, ModuleRow[]>,
  runId: string,
  brandName: string,
  ctx: { confidence: Confidence; allLayers: TruthLayer[] },
): Promise<ComposedSection> {
  // Special-case the confidence section: it's about the Truth Layer mix itself.
  if (def.id === 'confidence') {
    const mix = { verified: 0, assumed: 0, projected: 0 } as Record<TruthLayer, number>;
    for (const l of ctx.allLayers) mix[l] += 1;
    const facts = [
      `Overall run confidence: ${ctx.confidence.toUpperCase()}.`,
      `Truth Layer mix across module outputs — Verified: ${mix.verified}, Assumed: ${mix.assumed}, Projected: ${mix.projected}.`,
      'Verified = measured/sourced; Assumed = estimate with basis; Projected = modelled.',
    ];
    // No AI: the confidence read is a deterministic Truth-Layer summary the UI renders
    // as a segmented bar + the overall confidence pill.
    return {
      id: def.id,
      number: def.number,
      title: def.title,
      text: '',
      truthLayers: ctx.allLayers,
      grounded: facts,
      assessed: true,
      metrics: [],
    };
  }

  const rows = def.modules.flatMap((m) => byModule.get(m) ?? []);
  if (rows.length === 0) {
    return {
      id: def.id,
      number: def.number,
      title: def.title,
      text: `Not assessed for this run — no ${def.modules.join('/') || 'supporting'} module data was produced. This section is intentionally left blank rather than estimated.`,
      truthLayers: [],
      grounded: [],
      assessed: false,
      metrics: [],
    };
  }

  const facts = rows.flatMap(factsForModule);
  const truthLayers = rows.map((r) => r.truthLayer);
  const metrics = rows.flatMap(metricsForModule);

  return {
    id: def.id,
    number: def.number,
    title: def.title,
    text: '', // structured report — no AI prose
    truthLayers,
    grounded: facts,
    assessed: true,
    metrics,
  };
}
