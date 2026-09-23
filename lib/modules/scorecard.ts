/**
 * F9 — Self-Serve Site Scorecard. A one-page, brand-standard scorecard a franchisee
 * can apply to a walk-in site themselves, generated from the run's module results.
 * Serves ~92 brands (the 2nd-most-requested capability in the PFA data).
 *
 * It rolls the deterministic module results into weighted criteria with a
 * Go / Caution / No-Go band, carrying the Truth Layer of whatever data populates it.
 * Pure logic (server module composes the inputs); testable.
 */
import type { TruthLayer } from '@/lib/truth/truthLayer';

export interface ScorecardCriterion {
  key: string;
  label: string;
  /** 0–100 score from the module, or null when not assessed. */
  score: number | null;
  weight: number;
  truthLayer: TruthLayer | null;
  note: string;
}

export interface Scorecard {
  siteLabel: string;
  criteria: ScorecardCriterion[];
  composite: number | null;
  band: 'go' | 'caution' | 'nogo' | 'insufficient';
  truthLayer: TruthLayer;
}

/** Weighted composite over criteria that have a score. */
export function scorecardComposite(criteria: ScorecardCriterion[]): number | null {
  const scored = criteria.filter((c) => c.score != null);
  if (scored.length === 0) return null;
  const totalW = scored.reduce((s, c) => s + c.weight, 0) || 1;
  return Math.round((scored.reduce((s, c) => s + (c.score as number) * c.weight, 0) / totalW) * 10) / 10;
}

export function scorecardBand(composite: number | null): Scorecard['band'] {
  if (composite == null) return 'insufficient';
  if (composite >= 65) return 'go';
  if (composite >= 45) return 'caution';
  return 'nogo';
}

/** Weakest contributing Truth Layer drives the scorecard's overall classification. */
export function scorecardTruth(criteria: ScorecardCriterion[]): TruthLayer {
  const scored = criteria.filter((c) => c.score != null && c.truthLayer);
  if (scored.length === 0) return 'projected';
  if (scored.some((c) => c.truthLayer === 'projected')) return 'projected';
  if (scored.some((c) => c.truthLayer === 'assumed')) return 'assumed';
  return 'verified';
}

/** The criteria template — which modules map to which scorecard line, and their weight. */
export const SCORECARD_TEMPLATE: Array<{ key: string; label: string; module: string; weight: number }> = [
  { key: 'site_fit', label: 'Site fit (catchment & competition)', module: 'site_fit', weight: 0.3 },
  { key: 'territory', label: 'Territory (adds vs redistributes)', module: 'territory', weight: 0.25 },
  { key: 'lease', label: 'Lease value vs corridor', module: 'lease', weight: 0.2 },
  { key: 'demand', label: 'Demand timing (daypart)', module: 'daypart', weight: 0.1 },
  { key: 'competition', label: 'Competition (incl. informal)', module: 'informal', weight: 0.1 },
  { key: 'land', label: 'Land & traffic screen', module: 'land', weight: 0.05 },
];

export interface ModuleScore {
  module: string;
  score: number | null;
  truthLayer: TruthLayer;
  note: string;
}

/**
 * Turn a site's module scores into the weighted scorecard criteria. Shared by the
 * scorecard artifact AND the orchestrator's stored-composite recompute, so the
 * dashboard headline and the scorecard are computed from the SAME math and can
 * never disagree (e.g. a heavy-cannibalization site can't read "97 GO" on the
 * dashboard while the scorecard says "55.1 CAUTION").
 */
export function scorecardCriteria(moduleScores: ModuleScore[]): ScorecardCriterion[] {
  const byModule = new Map(moduleScores.map((m) => [m.module, m]));
  return SCORECARD_TEMPLATE.map((t) => {
    const m = byModule.get(t.module);
    // Territory score is an overlap % where HIGHER is worse → invert to a 0–100 goodness.
    let score = m?.score ?? null;
    if (t.module === 'territory' && score != null) score = Math.round((100 - score) * 10) / 10;
    return {
      key: t.key, label: t.label, score, weight: t.weight,
      truthLayer: m?.truthLayer ?? null,
      note: m?.note ?? 'Not assessed for this run.',
    };
  });
}

/**
 * When Site Fit can't be scored (no demographic/population layer → its demand pillar is
 * absent), the run is missing its single largest decision input. The secondary pillars
 * alone must NOT be allowed to manufacture a confident GO — so we cap the composite just
 * below the GO threshold, topping the verdict out at CAUTION until a demographic layer is
 * loaded. This mirrors the Site Fit module's own withholding and keeps the app honest:
 * "we can't confirm a GO without demand data." Applied to BOTH the dashboard headline and
 * the scorecard so they always agree.
 */
const NO_SITEFIT_GO_CAP = 64; // scorecardBand: >=65 GO, >=45 CAUTION → 64 tops out at CAUTION

function cappedComposite(criteria: ScorecardCriterion[]): number | null {
  let composite = scorecardComposite(criteria);
  const siteFit = criteria.find((c) => c.key === 'site_fit');
  const siteFitMissing = siteFit != null && siteFit.score == null;
  if (composite != null && siteFitMissing && composite > NO_SITEFIT_GO_CAP) {
    composite = NO_SITEFIT_GO_CAP;
  }
  return composite;
}

/**
 * The site's decision-grade composite + band from ALL contributing modules — the
 * single source of truth for both the dashboard headline and the scorecard band.
 * `band` is 'insufficient' when nothing scored.
 */
export function siteCompositeFromModules(moduleScores: ModuleScore[]): {
  composite: number | null;
  band: Scorecard['band'];
} {
  const criteria = scorecardCriteria(moduleScores);
  const composite = cappedComposite(criteria);
  return { composite, band: scorecardBand(composite) };
}

/** Build the scorecard from the run's module scores for one site. */
export function buildScorecard(siteLabel: string, moduleScores: ModuleScore[]): Scorecard {
  const criteria = scorecardCriteria(moduleScores);
  const composite = cappedComposite(criteria);
  return {
    siteLabel,
    criteria,
    composite,
    band: scorecardBand(composite),
    truthLayer: scorecardTruth(criteria),
  };
}

// ---------------------------------------------------------------------------------------
// Evidence confidence (Batch 3) — replaces the old "share of Projected rows" roll-up for
// runs. That rule read EVERY run as Low, because Territory, Daypart and White-Space are
// estimates by nature (always Projected), so ≥34% of rows were always Projected and the
// label carried no information.
//
// New rule: weight each module's evidence by how much it drives the decision (the same
// SCORECARD_TEMPLATE weights; contextual modules count a little), and value its Truth Layer:
//   Verified 1.0 · Assumed 0.7 · Projected 0.35 · expected-but-missing / unscorable Site Fit 0.
// evidence = Σ(weight·value) / Σ(weight)   →   High ≥ 0.75 · Medium ≥ 0.5 · Low < 0.5
// then one band lower when an on-ground check is advised (informal market, secondary terms
// over market, or a module failed for the site).
// In practice: good demand data + normal estimates → Medium; missing demand data (Site Fit
// unscorable) or failed modules → Low; High needs mostly Verified inputs on the heavy criteria.
// ---------------------------------------------------------------------------------------

export const TRUTH_EVIDENCE_VALUE: Record<TruthLayer, number> = { verified: 1, assumed: 0.7, projected: 0.35 };
/** Weight for modules that inform but don't score the composite (mall, healthcare, whitespace…). */
export const CONTEXT_MODULE_WEIGHT = 0.05;
export const EVIDENCE_HIGH = 0.75;
export const EVIDENCE_MED = 0.5;

export type EvidenceConfidence = 'high' | 'med' | 'low';

function moduleWeight(module: string): number {
  return SCORECARD_TEMPLATE.find((t) => t.module === module)?.weight ?? CONTEXT_MODULE_WEIGHT;
}

/**
 * Evidence score (0–1) for ONE site. `expectedModules` = what the pipeline should have produced
 * for this vertical; any that are missing count as zero evidence at their weight.
 */
export function siteEvidenceScore(
  rows: Array<{ module: string; score: number | null; truthLayer: TruthLayer }>,
  expectedModules: string[],
): number {
  const byModule = new Map(rows.filter((r) => r.module !== 'analysis').map((r) => [r.module, r]));
  const modules = new Set([...expectedModules.filter((m) => m !== 'analysis'), ...byModule.keys()]);
  let wSum = 0;
  let vSum = 0;
  for (const m of modules) {
    const w = moduleWeight(m);
    const r = byModule.get(m);
    let v = r ? TRUTH_EVIDENCE_VALUE[r.truthLayer] ?? 0 : 0;
    // Site Fit without a score = no demand evidence (the single largest decision input).
    if (m === 'site_fit' && r && r.score == null) v = 0;
    wSum += w;
    vSum += w * v;
  }
  return wSum > 0 ? Math.round((vSum / wSum) * 1000) / 1000 : 0;
}

export function evidenceBand(evidence: number, opts: { onGroundCheckFlagged?: boolean } = {}): EvidenceConfidence {
  let band: EvidenceConfidence = evidence >= EVIDENCE_HIGH ? 'high' : evidence >= EVIDENCE_MED ? 'med' : 'low';
  if (opts.onGroundCheckFlagged) band = band === 'high' ? 'med' : 'low';
  return band;
}

/** Run confidence = the band of the MEAN site evidence (every site weighs the same). */
export function runEvidenceConfidence(
  siteEvidence: number[],
  opts: { onGroundCheckFlagged?: boolean } = {},
): { confidence: EvidenceConfidence; evidence: number } {
  if (siteEvidence.length === 0) return { confidence: 'low', evidence: 0 };
  const evidence = Math.round((siteEvidence.reduce((a, b) => a + b, 0) / siteEvidence.length) * 1000) / 1000;
  return { confidence: evidenceBand(evidence, opts), evidence };
}

/** Lease criterion score: a VALUE score — rent at the corridor's 20th percentile scores 80.
 *  (The stored percentile runs the other way: higher = more expensive.) */
export function leaseValueScore(baseRentPercentile: number | null | undefined): number | null {
  if (baseRentPercentile == null || !Number.isFinite(baseRentPercentile)) return null;
  return Math.round(Math.max(0, Math.min(100, 100 - baseRentPercentile)) * 10) / 10;
}
