/**
 * BSA scoring configuration — the ONE place every scoring number lives (Brief alignment P0-2).
 *
 * Mirrors "BSA Investor Brief — Scoring & Data Verification" (3 Nov 2026). The brief says the
 * weights, bands and crowding threshold are "set in the prototype and awaiting final approval":
 * when they are approved, change them here only — every module, report and PDF reads from this file.
 * Pure (no server imports) so it is safe on server and client and unit-testable.
 */

/** Shown in the report/PDF footer so a reader knows which rule set produced the call. */
export const SCORING_METHOD_VERSION = 'Scoring v1.0 (prototype — pending final approval)';

/** The six questions, their module and weight (sum = 1). A check with no data drops out and
 *  the remaining weights are rescaled to 100 % — missing data never counts as zero. */
export const SCORE_WEIGHTS = {
  site_fit: 0.3,
  territory: 0.25,
  lease: 0.2,
  daypart: 0.1,
  informal: 0.1,
  land: 0.05,
} as const;

/** Score → verdict bands: ≥ GO Proceed · ≥ CAUTION Proceed with caution · below = No-Go. */
export const BAND_GO = 65;
export const BAND_CAUTION = 45;

export type Band = 'go' | 'caution' | 'nogo';
/** The single band function for any 0–100 "higher is better" score. */
export function bandForScore(score: number): Band {
  if (score >= BAND_GO) return 'go';
  if (score >= BAND_CAUTION) return 'caution';
  return 'nogo';
}

/** Override rules. */
export const OWN_OVERLAP_NOGO_PCT = 40;      // own-branch overlap ≥ this → No-Go
export const OWN_OVERLAP_CAUTION_PCT = 15;   // own-branch overlap ≥ this → at most Caution
export const CROWDED_SATURATION_PCT = 40;    // competitor saturation ≥ this → at most Caution
export const NOGO_CAP = BAND_CAUTION - 1;    // 44 — a capped score always reads No-Go
export const CAUTION_CAP = BAND_GO - 1;      // 64 — a capped score tops out at Caution
/** No population data → Site Fit unscored → capped at Caution (third override). */
export const NO_SITEFIT_CAP = CAUTION_CAP;

/** Trade area by store format, metres (Assumed, documented). */
export const TRADE_AREA_M: Record<string, number> = {
  kiosk: 600,
  inline: 900,
  mall: 1200,
  default: 1000,
};
export function tradeAreaRadius(format: string | null | undefined): number {
  if (!format) return TRADE_AREA_M.default;
  return TRADE_AREA_M[format] ?? TRADE_AREA_M.default;
}

/**
 * Site Fit and Informal thresholds were calibrated on fixed circles (people within 1,200 m,
 * competitors within 800 m). With a format-based trade area, the thresholds scale with the
 * circle's AREA so a kiosk is judged on the smaller crowd its 600 m circle can hold (a density
 * read), not penalised for a smaller circle. Documented assumption.
 */
export const DEMAND_REF_RADIUS_M = 1200;
export const DEMAND_MIN_PEOPLE = 2000;    // at the reference radius → demand score 0
export const DEMAND_FULL_PEOPLE = 40000;  // at the reference radius → demand score 100
export const COMPETITION_REF_RADIUS_M = 800;
export const COMPETITION_FULL_COUNT = 12; // at the reference radius → headroom 0
export const INFORMAL_HALF_COUNT = 12;    // at the reference radius → informal score 50
export function areaScale(radiusM: number, refRadiusM: number): number {
  return (radiusM / refRadiusM) ** 2;
}

/** Confidence: value per Truth Layer, weighted by each check's weight. */
export const TRUTH_VALUE = { verified: 1, assumed: 0.7, projected: 0.35 } as const;
export const CONFIDENCE_HIGH = 0.75;
export const CONFIDENCE_MEDIUM = 0.5;
/** Weight for context checks that inform but don't score (mall, healthcare, white-space). */
export const CONTEXT_CHECK_WEIGHT = 0.05;

/** Module flags that mean "an on-site visit is advised" (drops confidence one level). */
export const SITE_VISIT_FLAGS = ['on_ground_check_advised', 'low_poi_coverage', 'secondary_terms_over_market'] as const;
