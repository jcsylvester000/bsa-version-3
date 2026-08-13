/**
 * Pure Territory Guard math — no server-only imports, so it is unit-testable and
 * reusable on both server and (if ever needed) client. The server module
 * (territoryGuard.ts) re-exports these alongside its DB-touching functions.
 */

/** Catchment radius assumption by outlet format, metres. Assumed, documented. */
export const FORMAT_CATCHMENT_M: Record<string, number> = {
  inline: 900,
  mall: 1200,
  kiosk: 600,
  default: 1000,
};

export function catchmentRadius(format: string | null | undefined): number {
  if (!format) return FORMAT_CATCHMENT_M.default;
  return FORMAT_CATCHMENT_M[format] ?? FORMAT_CATCHMENT_M.default;
}

/**
 * Fraction of a new branch's volume assumed cannibalized from a given overlap %.
 * Modelled (Projected): a convex response — light overlap barely bites, heavy
 * overlap redistributes most of the shared catchment. Documented assumption.
 */
export function cannibalizationFraction(overlapPct: number): number {
  const o = Math.max(0, Math.min(100, overlapPct)) / 100;
  return Math.round(o * o * 1000) / 1000;
}

export type TerritoryVerdict = 'adds' | 'mixed' | 'redistributes';

/** Verdict from the Verified overlap measurement (not the Projected PHP). */
export function verdictFromOverlap(maxOverlapPct: number): TerritoryVerdict {
  if (maxOverlapPct >= 40) return 'redistributes';
  if (maxOverlapPct >= 15) return 'mixed';
  return 'adds';
}

// ============================================================================
// Competitive-saturation cannibalization (Projected)
// ----------------------------------------------------------------------------
// The own-outlet overlap above measures cannibalization of the BRAND'S OWN branches
// (Verified, from coordinates). But a NEW or independent brand has no own outlets, so
// that signal is 0 — which reads as "no cannibalization" when the trade area may be
// saturated with the SAME-CONCEPT COMPETITORS defined in the cannibalization map.
//
// This function models that second signal: given the count of concept-matching competitor
// establishments inside the candidate's catchment (from the POI cache + competitor_set),
// it returns a saturation-driven cannibalization %. It is explicitly Projected — a modelled
// market-saturation proxy, never a measured overlap — and is surfaced/labelled as such.
// ============================================================================

/**
 * Reference density: the tier-weighted competitor count at which a catchment reads as
 * solidly saturated (~63% of the ceiling). This is a SCALE, not a cap — the curve keeps
 * rising past it, so an extraordinarily dense corridor still separates from a merely busy
 * one. Tuned to NCR, where a busy corridor commonly shows 15–25 weighted competitors
 * within ~1–2 km and a prime food strip (España, Recto, Cubao) runs well past 40.
 */
export const SATURATION_SCALE_COUNT = 20;

/** Back-compat alias for the previous constant name. @deprecated use SATURATION_SCALE_COUNT */
export const SATURATION_FULL_COUNT = SATURATION_SCALE_COUNT;

/**
 * Asymptotic ceiling on the modelled competitive cannibalization %. APPROACHED, never
 * reached, so the model never claims a total loss of trade — and, unlike a hard clamp,
 * never reports two very different corridors as the same number.
 */
export const SATURATION_MAX_PCT = 95;

/**
 * Modelled competitive cannibalization % from the tier-weighted competitor count in the
 * catchment. Projected (a market-saturation proxy, not a measured trade-area overlap).
 *
 * Shape: exponential saturation, MAX × (1 − e^(−n / SCALE)). The first few competitors bite
 * hardest (a virgin catchment vs one with 3 rivals is a big jump), each additional one adds
 * less, and the curve flattens toward the ceiling WITHOUT ever clamping.
 *
 * Why the change: the previous curve normalised on min(1, n/20) and therefore returned a flat
 * 85% for ANY count at or above 20 — a corridor with 20 rivals and one with 90 scored
 * identically, which is exactly the discrimination a site-selection tool needs most in dense
 * NCR corridors. Reference points on the current curve:
 *
 *      n =  3 →  13.2%      n = 20 → 60.0%      n = 60 → 90.3%
 *      n =  5 →  21.0%      n = 30 → 73.8%      n = 80 → 93.3%
 *      n = 10 →  37.4%      n = 43 → 84.0%      n =120 → 94.8%
 *
 * `n` is fractional by design — it arrives tier-weighted (direct rivals count 1.0, adjacent
 * formats ~0.35), so it must NOT be floored. Deterministic and documented; the AI layer only
 * phrases the result, never recomputes it.
 */
export function competitiveSaturationPct(competitorCount: number): number {
  const n = Math.max(0, competitorCount);
  if (n <= 0) return 0;
  const shaped = 1 - Math.exp(-n / SATURATION_SCALE_COUNT);
  return Math.round(shaped * SATURATION_MAX_PCT * 10) / 10;
}

/**
 * One plain-language reading of the competitive-saturation signal for the UI/report.
 * Kept here (pure) so the same wording is used everywhere the number appears. The top band
 * exists so an extreme corridor reads differently from a merely saturated one.
 */
export function saturationLabel(competitorCount: number, pct: number): string {
  if (competitorCount <= 0) return 'No same-concept competitors found in the catchment';
  const band = pct >= 85 ? 'heavily saturated'
    : pct >= 60 ? 'saturated'
    : pct >= 30 ? 'contested'
    : 'lightly contested';
  const n = Math.round(competitorCount * 10) / 10;
  return `${n} weighted competitor${n === 1 ? '' : 's'} in the catchment — ${band}`;
}
