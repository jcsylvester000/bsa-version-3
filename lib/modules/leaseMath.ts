/**
 * Pure Lease Benchmark math — no server-only imports, fully unit-testable.
 *
 * Given a set of comparable leases and a site's asking terms, this computes:
 *  - the distribution stats for each term (min, median, p25/p75, max),
 *  - where the site's asking rate sits (percentile) in the comp distribution,
 *  - an over/under-market flag per term, and
 *  - the negotiating room to reach the corridor median.
 *
 * Truth Layer discipline:
 *  - The comps themselves are Verified against source leases.
 *  - The fair-range / percentile read is an estimate → Assumed, and is only trusted
 *    when the sample is large enough; below a floor we downgrade and flag it.
 *
 * No number is invented: everything here is derived from the comps passed in.
 */
import { canonicalCity, inferCorridor } from '@/lib/geo/regions';
import type { TruthLayer } from '@/lib/truth/truthLayer';

/** Minimum comps for a term before its benchmark is considered reliable. */
export const MIN_SAMPLE = 5;

/** How far from the median counts as "at market" vs over/under (fraction). */
export const AT_MARKET_BAND = 0.05; // ±5% of median reads as at-market

export type TermKey = 'baseRentPhpSqm' | 'escalationPct' | 'cusaPhpSqm' | 'leaseTermYears' | 'fitoutMonths';

export interface Comp {
  baseRentPhpSqm?: number | null;
  escalationPct?: number | null;
  cusaPhpSqm?: number | null;
  leaseTermYears?: number | null;
  fitoutMonths?: number | null;
}

export interface DistributionStats {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}

/** Linear-interpolated quantile (0..1) over a numeric array. Sorts internally. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1] ?? sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

export function distribution(values: Array<number | null | undefined>): DistributionStats | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return {
    n: nums.length,
    min: Math.min(...nums),
    p25: round2(quantile(nums, 0.25)),
    median: round2(quantile(nums, 0.5)),
    p75: round2(quantile(nums, 0.75)),
    max: Math.max(...nums),
  };
}

/**
 * Percentile rank (0–100) of `value` within the comp values — the share of comps
 * at or below the asking rate. This is the "how far the rate sits from the corridor
 * median" read expressed as a position in the spread.
 */
export function percentileRank(values: number[], value: number): number {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return NaN;
  const below = nums.filter((v) => v < value).length;
  const equal = nums.filter((v) => v === value).length;
  // Mid-rank for ties.
  return round1(((below + equal / 2) / nums.length) * 100);
}

export type MarketFlag = 'over' | 'under' | 'at' | 'insufficient';

/**
 * For a term where HIGHER is worse for the tenant (rent, escalation, CUSA, fit-out),
 * "over" market = the site is above the median (paying/committing more than typical).
 * For lease term-length, longer is not inherently "worse", so callers can invert.
 */
export function flagVsMedian(
  value: number | null | undefined,
  stats: DistributionStats | null,
  opts: { higherIsWorse?: boolean } = { higherIsWorse: true },
): MarketFlag {
  if (value == null || !Number.isFinite(value)) return 'insufficient';
  if (!stats || stats.n < MIN_SAMPLE) return 'insufficient';
  const rel = (value - stats.median) / (stats.median || 1);
  if (Math.abs(rel) <= AT_MARKET_BAND) return 'at';
  const above = rel > 0;
  const higherIsWorse = opts.higherIsWorse ?? true;
  // "over" = worse-than-typical for the tenant.
  if (higherIsWorse) return above ? 'over' : 'under';
  return above ? 'under' : 'over';
}

export interface TermAssessment {
  term: TermKey;
  label: string;
  value: number | null;
  stats: DistributionStats | null;
  percentile: number | null; // only meaningful for base rent (the headline)
  flag: MarketFlag;
  higherIsWorse: boolean;
}

export interface LeaseBenchmarkOutput {
  /** The headline: base-rent percentile in the corridor comp spread. */
  baseRentPercentile: number | null;
  baseRentStats: DistributionStats | null;
  terms: TermAssessment[];
  sampleSize: number;
  /** True when the sample is thin — the fair-range read is downgraded. */
  lowSample: boolean;
  /** PHP/sqm the site sits above the corridor median on base rent (>0 = above the median). */
  negotiatingRoomPhpSqm: number | null;
  /** Same as a % of the median. */
  negotiatingRoomPct: number | null;
  verdict: 'below_market' | 'at_market' | 'above_market' | 'insufficient_data' | 'corridor_benchmark';
  flags: string[];
}

const TERM_LABELS: Record<TermKey, string> = {
  baseRentPhpSqm: 'Base rent (₱/sqm)',
  escalationPct: 'Escalation (%/yr)',
  cusaPhpSqm: 'CUSA (₱/sqm)',
  leaseTermYears: 'Lease term (years)',
  fitoutMonths: 'Fit-out period (months)',
};

// Which direction is "worse" for the tenant. Lease term left neutral-ish:
// a longer commitment is treated as higher-risk → higherIsWorse=true, but callers
// reading it should note it's a risk read, not a price read.
const HIGHER_IS_WORSE: Record<TermKey, boolean> = {
  baseRentPhpSqm: true,
  escalationPct: true,
  cusaPhpSqm: true,
  leaseTermYears: true,
  fitoutMonths: false, // a longer fit-out period is generally a tenant concession → not worse
};

export interface SiteTerms {
  baseRentPhpSqm?: number | null;
  escalationPct?: number | null;
  cusaPhpSqm?: number | null;
  leaseTermYears?: number | null;
  fitoutMonths?: number | null;
}

/**
 * The full benchmark. Deterministic; the AI later only phrases this.
 */
export function benchmarkLease(site: SiteTerms, comps: Comp[]): LeaseBenchmarkOutput {
  const termKeys: TermKey[] = ['baseRentPhpSqm', 'escalationPct', 'cusaPhpSqm', 'leaseTermYears', 'fitoutMonths'];

  const terms: TermAssessment[] = termKeys.map((term) => {
    const values = comps.map((c) => c[term]);
    const stats = distribution(values);
    const value = site[term] ?? null;
    const higherIsWorse = HIGHER_IS_WORSE[term];
    const percentile =
      term === 'baseRentPhpSqm' && stats && value != null
        ? percentileRank(values.filter((v): v is number => typeof v === 'number'), value)
        : null;
    return {
      term,
      label: TERM_LABELS[term],
      value,
      stats,
      percentile,
      flag: flagVsMedian(value, stats, { higherIsWorse }),
      higherIsWorse,
    };
  });

  const baseRent = terms.find((t) => t.term === 'baseRentPhpSqm')!;
  const sampleSize = baseRent.stats?.n ?? 0;
  const lowSample = sampleSize < MIN_SAMPLE;

  let negotiatingRoomPhpSqm: number | null = null;
  let negotiatingRoomPct: number | null = null;
  if (baseRent.value != null && baseRent.stats) {
    negotiatingRoomPhpSqm = round2(baseRent.value - baseRent.stats.median);
    negotiatingRoomPct = round1((negotiatingRoomPhpSqm / (baseRent.stats.median || 1)) * 100);
  }

  // Verdict distinguishes THREE cases (previously two were conflated):
  //  - No comps at all (or too thin) → genuinely insufficient_data.
  //  - Comps exist but the user hasn't entered an asking rent yet (the pipeline runs
  //    with empty siteTerms): we can't score THEIR rent, but the corridor's own rent
  //    range/median IS a valid market read → corridor_benchmark. This is the common
  //    case at run time and delivers real value ("BGC leases run ₱X–Y, median ₱Z").
  //  - Asking rent present + a real sample → the percentile verdicts.
  let verdict: LeaseBenchmarkOutput['verdict'];
  if (!baseRent.stats || lowSample) verdict = 'insufficient_data';
  else if (baseRent.value == null) verdict = 'corridor_benchmark';
  else if (baseRent.flag === 'over') verdict = 'above_market';
  else if (baseRent.flag === 'under') verdict = 'below_market';
  else verdict = 'at_market';

  const flags: string[] = [];
  if (lowSample) flags.push('low_sample');
  if (verdict === 'above_market') flags.push('base_rent_above_corridor_median');
  if (terms.some((t) => t.flag === 'over' && t.term !== 'baseRentPhpSqm')) flags.push('secondary_terms_over_market');

  return {
    baseRentPercentile: baseRent.percentile,
    baseRentStats: baseRent.stats,
    terms,
    sampleSize,
    lowSample,
    negotiatingRoomPhpSqm,
    negotiatingRoomPct,
    verdict,
    flags,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// inferCorridor now lives in lib/geo/regions (the region registry) so a province is
// configuration, not code. Imported above for local use (resolveCorridorForSite) and
// re-exported here unchanged for the orchestrator, the Lease Benchmark tool and tests.
export { inferCorridor };


/**
 * Resolve the corridor to preselect for a site in the Lease Benchmark tool.
 *
 * Infers from the site's city/label, but only commits to that corridor if it
 * actually appears in the available list (the corridors we hold comps for) —
 * a case-insensitive match. Otherwise falls back to the provided default so the
 * picker never lands on a corridor with no data.
 */
export function resolveCorridorForSite(
  site: { city?: string | null; label?: string | null } | null | undefined,
  available: string[],
  fallback: string,
): string {
  const inferred = inferCorridor(site?.city, site?.label);
  if (inferred) {
    const match = available.find((c) => c.toLowerCase() === inferred.toLowerCase());
    if (match) return match;
  }
  return fallback;
}

// ============================================================================
// BIR ZONAL-VALUE cross-check + fallback rent anchor (Projected).
// ----------------------------------------------------------------------------
// Grid guardrail: BIR zonal values are a TAX-REFERENCE FLOOR, never a market price
// verdict. So zonal never replaces the comp-based verdict — it (1) anchors every
// lease read to a Verified commercial land value, (2) cross-checks the asking rent
// against that land value, and (3) supplies an INDICATIVE band when comps are too
// thin to score, always labelled Projected.
//
// Calibration (2026-08): across the 13 NCR corridors that have BOTH lease comps and
// commercial (CR) zonal, median monthly rent ≈ ₱10 per ₱1,000 of the commercial-zonal
// midpoint (~1.0%/mo). Stable at ₱8–12 across mid-tier corridors (Ortigas, QC, Pasay,
// Mandaluyong, Alabang, Manila, CAMANAVA); compresses in the CBD (BGC/Makati trophy-
// street zonal is inflated → ₱3–5) and widens in low-tier fringes (Marikina/Pateros
// → ₱25–37). Hence a band, never a point rent.
// ============================================================================

/** Monthly rent (₱/sqm) per ₱1,000 of commercial-zonal midpoint — central + reliable band. */
export const ZONAL_RENT_PER_1000_CENTRAL = 10.0;
export const ZONAL_RENT_PER_1000_LOW = 6.0;
export const ZONAL_RENT_PER_1000_HIGH = 14.0;

export type ZonalGrain = 'barangay' | 'city';

/** The commercial zonal band resolved for a site (CR preferred, CC fallback). */
export interface ZonalBand {
  code: string;            // 'CR' | 'CC'
  classification: string;  // human label
  lowPhpSqm: number | null;
  highPhpSqm: number | null;
  midPhpSqm: number | null;
  grain: ZonalGrain;       // barangay match vs city fallback
  cityMunicipality: string;
  barangay: string | null;
  truthLayer: TruthLayer;  // Verified (BIR schedule) typically
}

/** Midpoint of a low/high band (or whichever bound is present). */
export function bandMid(low: number | null, high: number | null): number | null {
  if (low != null && high != null) return Math.round((low + high) / 2);
  return low ?? high ?? null;
}

export type ZonalRentPosition = 'rich' | 'inline' | 'thin' | 'unknown';

export interface ZonalCrossCheck {
  /** asking monthly rent ÷ zonal mid × 1000 = rent per ₱1,000 of commercial land value. */
  rentPer1000: number | null;
  position: ZonalRentPosition; // vs the calibrated ₱6–14 band
  note: string;
}

/** Where the asking rent sits against the underlying commercial land value. Projected. */
export function zonalRentCrossCheck(
  askingRentPhpSqm: number | null | undefined,
  zonalMid: number | null,
): ZonalCrossCheck {
  if (askingRentPhpSqm == null || zonalMid == null || zonalMid <= 0) {
    return { rentPer1000: null, position: 'unknown', note: 'Not enough data to compare rent to land value.' };
  }
  const r = Math.round((askingRentPhpSqm / zonalMid) * 1000 * 10) / 10;
  const position: ZonalRentPosition =
    r > ZONAL_RENT_PER_1000_HIGH ? 'rich' : r < ZONAL_RENT_PER_1000_LOW ? 'thin' : 'inline';
  const note =
    position === 'rich'
      ? `Rent runs ₱${r}/mo per ₱1,000 of commercial land value — above the typical ₱${ZONAL_RENT_PER_1000_LOW}–${ZONAL_RENT_PER_1000_HIGH} NCR band, so it is rich relative to the land.`
      : position === 'thin'
        ? `Rent runs ₱${r}/mo per ₱1,000 of commercial land value — below the typical band; cheap relative to the land (or a prime-CBD zone where zonal is inflated).`
        : `Rent runs ₱${r}/mo per ₱1,000 of commercial land value — in line with typical NCR corridors.`;
  return { rentPer1000: r, position, note };
}

export interface IndicativeRent {
  lowPhpSqm: number | null;
  highPhpSqm: number | null;
  midPhpSqm: number | null;
}

/**
 * Indicative monthly rent band derived from the commercial zonal midpoint, for when
 * lease comps are too thin to score. Projected and deliberately wide (the ₱6–14 band).
 */
export function indicativeRentFromZonal(zonalMid: number | null): IndicativeRent {
  if (zonalMid == null || zonalMid <= 0) return { lowPhpSqm: null, highPhpSqm: null, midPhpSqm: null };
  return {
    lowPhpSqm: Math.round((ZONAL_RENT_PER_1000_LOW / 1000) * zonalMid),
    highPhpSqm: Math.round((ZONAL_RENT_PER_1000_HIGH / 1000) * zonalMid),
    midPhpSqm: Math.round((ZONAL_RENT_PER_1000_CENTRAL / 1000) * zonalMid),
  };
}

/**
 * Canonical NCR city for the zonal lookup. A thin wrapper over the region registry's
 * `canonicalCity`, returning the LGU only when the site resolves to NCR (behaviour
 * unchanged). Province-aware callers use `canonicalCity` / `regionForSite` from lib/geo/regions.
 */
export function canonicalNcrCity(city: string | null | undefined, label?: string | null): string | null {
  const r = canonicalCity(city, label);
  return r && r.region === 'ncr' ? r.city : null;
}
