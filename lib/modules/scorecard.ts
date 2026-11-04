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
import { territoryCall, type TerritoryCallInput } from './territoryMath';
import {
  SCORE_WEIGHTS, BAND_GO, BAND_CAUTION, NO_SITEFIT_CAP, OWN_OVERLAP_NOGO_PCT, OWN_OVERLAP_CAUTION_PCT,
  NOGO_CAP, CAUTION_CAP, TRUTH_VALUE, CONTEXT_CHECK_WEIGHT, CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, SITE_VISIT_FLAGS,
} from './scoringConfig';

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
  if (composite >= BAND_GO) return 'go';
  if (composite >= BAND_CAUTION) return 'caution';
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
  { key: 'site_fit', label: 'Site fit (catchment & competition)', module: 'site_fit', weight: SCORE_WEIGHTS.site_fit },
  { key: 'territory', label: 'Territory (adds vs redistributes)', module: 'territory', weight: SCORE_WEIGHTS.territory },
  { key: 'lease', label: 'Lease value vs corridor', module: 'lease', weight: SCORE_WEIGHTS.lease },
  { key: 'demand', label: 'Demand timing (daypart)', module: 'daypart', weight: SCORE_WEIGHTS.daypart },
  { key: 'competition', label: 'Competition (incl. informal)', module: 'informal', weight: SCORE_WEIGHTS.informal },
  { key: 'land', label: 'Land & traffic screen', module: 'land', weight: SCORE_WEIGHTS.land },
];

export interface ModuleScore {
  module: string;
  score: number | null;
  truthLayer: TruthLayer;
  note: string;
  /** Territory rows: the payload's overlap split, so the gate can tell own-branch overlap
   *  (deal-breaker) from competitor saturation (caution). Omitted → legacy (score-only) gate. */
  territory?: TerritoryCallInput | null;
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
const NO_SITEFIT_GO_CAP = NO_SITEFIT_CAP; // scorecardBand: >=65 GO, >=45 CAUTION → 64 tops out at CAUTION

/**
 * Territory deal-breaker (2026-10-07, owner + Skill 07). A weighted average let strong demand / lease /
 * site-fit scores outvote a site that takes most of its sales from the brand's own branch — e.g. 75 %
 * own-branch overlap still read "65 · Proceed". Cannibalization is a knock-out, not one vote among six:
 *   Territory overlap ≥ 40 % (module verdict "redistributes") → composite capped at 44 → No-Go
 *   Territory overlap ≥ 15 % (module verdict "mixed")         → composite capped at 64 → at most Caution
 * Same thresholds as territoryMath.verdictFromOverlap, so the score can never disagree with the
 * Territory Guard call. The overlap is the module's headline (max of own-branch and competitive).
 */
export const TERRITORY_NOGO_OVERLAP_PCT = OWN_OVERLAP_NOGO_PCT;
export const TERRITORY_CAUTION_OVERLAP_PCT = OWN_OVERLAP_CAUTION_PCT;
const TERRITORY_NOGO_CAP = NOGO_CAP;
const TERRITORY_CAUTION_CAP = CAUTION_CAP;

export interface TerritoryGate { cap: number | null; maxBand: 'nogo' | 'caution' | null; reason: string | null }

export function territoryGate(overlapPct: number | null | undefined, split?: TerritoryCallInput | null): TerritoryGate {
  // Split known (new rule, 2026-10-16): only own-branch overlap is a deal-breaker; a crowded
  // corridor of competitors caps at Caution. See territoryMath.territoryCall.
  if (split) {
    const call = territoryCall({ maxOverlapPct: overlapPct ?? null, ...split });
    const own = call.ownPct ?? 0;
    const pct = (v: number) => Math.round(v * 10) / 10;
    if (call.verdict === 'redistributes') {
      return { cap: TERRITORY_NOGO_CAP, maxBand: 'nogo', reason: `Cannibalization deal-breaker: ${pct(own)}% overlap with the brand's own branches (≥ ${TERRITORY_NOGO_OVERLAP_PCT}%) — the site mostly redistributes existing sales.` };
    }
    if (call.verdict === 'mixed') {
      return {
        cap: TERRITORY_CAUTION_CAP, maxBand: 'caution',
        reason: own >= TERRITORY_CAUTION_OVERLAP_PCT
          ? `Cannibalization risk: ${pct(own)}% overlap with the brand's own branches (≥ ${TERRITORY_CAUTION_OVERLAP_PCT}%) — cannot rate above Caution.`
          : `Contested corridor: competitor saturation ${pct(call.competitivePct ?? 0)}% — cannot rate above Caution (the brand's own branches are not at risk).`,
      };
    }
    if (call.verdict) return { cap: null, maxBand: null, reason: null };
  }
  if (overlapPct == null || !Number.isFinite(overlapPct)) return { cap: null, maxBand: null, reason: null };
  if (overlapPct >= TERRITORY_NOGO_OVERLAP_PCT) {
    return { cap: TERRITORY_NOGO_CAP, maxBand: 'nogo', reason: `Cannibalization deal-breaker: ${Math.round(overlapPct * 10) / 10}% territory overlap (≥ ${TERRITORY_NOGO_OVERLAP_PCT}%) — the site mostly redistributes existing sales.` };
  }
  if (overlapPct >= TERRITORY_CAUTION_OVERLAP_PCT) {
    return { cap: TERRITORY_CAUTION_CAP, maxBand: 'caution', reason: `Cannibalization risk: ${Math.round(overlapPct * 10) / 10}% territory overlap (≥ ${TERRITORY_CAUTION_OVERLAP_PCT}%) — cannot rate above Caution.` };
  }
  return { cap: null, maxBand: null, reason: null };
}

/** Apply the territory gate to a stored/computed composite (also used at read time for older runs). */
export function gateComposite(composite: number | null, overlapPct: number | null | undefined, split?: TerritoryCallInput | null): number | null {
  const g = territoryGate(overlapPct, split);
  return composite != null && g.cap != null ? Math.min(composite, g.cap) : composite;
}

/** Raw territory overlap % from the criteria (the criterion stores 100 − overlap). */
function overlapFromCriteria(criteria: ScorecardCriterion[]): number | null {
  const t = criteria.find((c) => c.key === 'territory');
  return t?.score != null ? Math.round((100 - t.score) * 10) / 10 : null;
}

function territorySplit(moduleScores: ModuleScore[]): TerritoryCallInput | null {
  return moduleScores.find((m) => m.module === 'territory')?.territory ?? null;
}

function cappedComposite(criteria: ScorecardCriterion[], split: TerritoryCallInput | null = null): number | null {
  let composite = scorecardComposite(criteria);
  const siteFit = criteria.find((c) => c.key === 'site_fit');
  const siteFitMissing = siteFit != null && siteFit.score == null;
  if (composite != null && siteFitMissing && composite > NO_SITEFIT_GO_CAP) {
    composite = NO_SITEFIT_GO_CAP;
  }
  return gateComposite(composite, overlapFromCriteria(criteria), split);
}

/**
 * The site's decision-grade composite + band from ALL contributing modules — the
 * single source of truth for both the dashboard headline and the scorecard band.
 * `band` is 'insufficient' when nothing scored.
 */
export function siteCompositeFromModules(moduleScores: ModuleScore[]): {
  composite: number | null;
  band: Scorecard['band'];
  /** The weighted average before any cap (shown as "would score X" when a deal-breaker applies). */
  uncapped: number | null;
  gate: TerritoryGate;
} {
  const criteria = scorecardCriteria(moduleScores);
  const split = territorySplit(moduleScores);
  const composite = cappedComposite(criteria, split);
  return { composite, band: scorecardBand(composite), uncapped: scorecardComposite(criteria), gate: territoryGate(overlapFromCriteria(criteria), split) };
}

/** Build the scorecard from the run's module scores for one site. */
export function buildScorecard(siteLabel: string, moduleScores: ModuleScore[]): Scorecard {
  const criteria = scorecardCriteria(moduleScores);
  const composite = cappedComposite(criteria, territorySplit(moduleScores));
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

export const TRUTH_EVIDENCE_VALUE: Record<TruthLayer, number> = { ...TRUTH_VALUE };
/** Weight for modules that inform but don't score the composite (mall, healthcare, whitespace…). */
export const CONTEXT_MODULE_WEIGHT = CONTEXT_CHECK_WEIGHT;
export const EVIDENCE_HIGH = CONFIDENCE_HIGH;
export const EVIDENCE_MED = CONFIDENCE_MEDIUM;

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

/**
 * Why an on-site visit is advised for ONE site (Brief alignment S-2). Only real signals count:
 * the informal check found informal sellers at least as many as mapped ones, the area has no
 * mapped places at all, lease terms run over market, or a check failed for the site.
 * (Before: ANY informal result dropped the whole run a level, whatever it found.)
 */
export function siteVisitReasons(
  rows: Array<{ module: string; flags?: string[] | null }>,
  pipelineError?: string | null,
): string[] {
  const reasons = new Set<string>();
  for (const r of rows) {
    for (const f of r.flags ?? []) {
      if ((SITE_VISIT_FLAGS as readonly string[]).includes(f)) reasons.add(f);
    }
  }
  if (pipelineError) reasons.add('check_failed');
  return Array.from(reasons);
}

/** Plain words for a site-visit reason key (UI, report, PDF). */
export const SITE_VISIT_REASON_LABEL: Record<string, string> = {
  on_ground_check_advised: 'informal sellers likely outnumber mapped ones',
  low_poi_coverage: 'no mapped places nearby yet',
  secondary_terms_over_market: 'lease terms above market',
  check_failed: 'a check could not finish for this site',
};

/** One site's confidence from its own evidence, one level lower when a visit is advised. */
export function siteConfidence(
  rows: Array<{ module: string; score: number | null; truthLayer: TruthLayer; flags?: string[] | null }>,
  expectedModules: string[],
  pipelineError?: string | null,
): { confidence: EvidenceConfidence; evidence: number; visitReasons: string[] } {
  const evidence = siteEvidenceScore(rows, expectedModules);
  const visitReasons = siteVisitReasons(rows, pipelineError);
  return { confidence: evidenceBand(evidence, { onGroundCheckFlagged: visitReasons.length > 0 }), evidence, visitReasons };
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
