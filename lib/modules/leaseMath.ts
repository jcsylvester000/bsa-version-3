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
  /** PHP/sqm the site sits above the corridor median on base rent (>0 = overpaying). */
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
  if (verdict === 'above_market') flags.push('overpaying_base_rent');
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

/**
 * Corridor inference from a site's city/label → a corridor that has lease_comp data.
 *
 * This is the SINGLE source of truth for mapping a candidate site to its rent
 * corridor. It lives here (pure, no server-only imports) so BOTH the pipeline
 * orchestrator and the client-side Lease Benchmark tool resolve a site to the
 * same corridor — a BGC site benchmarks against BGC comps in every surface, not
 * an alphabetically-first corridor.
 *
 * Order matters: check the most specific tokens (BGC) before city fallbacks.
 * Returns null when nothing matches (missing/foreign city); callers fall back to
 * a default corridor that has comps so Lease still returns an honest benchmark.
 */
export function inferCorridor(city: string | null | undefined, label: string | null | undefined): string | null {
  const hay = `${city ?? ''} ${label ?? ''}`.toLowerCase();
  // Most-specific corridor tokens first.
  if (hay.includes('bgc') || hay.includes('bonifacio') || hay.includes('taguig')) return 'BGC';
  if (hay.includes('ortigas') || hay.includes('pasig') || hay.includes('kapitolyo') || hay.includes('capitol') || hay.includes('san antonio')) return 'Ortigas';
  if (hay.includes('makati')) return 'Makati CBD';
  // City-level fallbacks to corridors that have comps in the dataset.
  if (hay.includes('greenhills') || hay.includes('san juan') || hay.includes('wack') || hay.includes('little baguio')) return 'San Juan';
  if (hay.includes('pateros')) return 'Pateros';
  if (hay.includes('pasay') || hay.includes('moa') || hay.includes('mall of asia') || hay.includes('bay area')) return 'Pasay Bay Area';
  // Parañaque shares the Bay Area / Aseana + Alabang-Zapote retail belt; use Pasay Bay Area comps.
  if (hay.includes('parañaque') || hay.includes('paranaque') || hay.includes('bf homes') || hay.includes('sucat') || hay.includes('bicutan') || hay.includes('aseana')) return 'Pasay Bay Area';
  if (hay.includes('quezon city') || hay.includes(' qc') || hay.startsWith('qc') || hay.includes('cubao') || hay.includes('timog') || hay.includes('katipunan') || hay.includes('araneta')) return 'Quezon City';
  if (hay.includes('alabang') || hay.includes('muntinlupa') || hay.includes('festival') || hay.includes('filinvest')) return 'Alabang';
  if (hay.includes('mandaluyong') || hay.includes('boni') || hay.includes('shaw')) return 'Mandaluyong';
  if (hay.includes('marikina')) return 'Marikina';
  if (hay.includes('manila') || hay.includes('divisoria') || hay.includes('binondo') || hay.includes('espana') || hay.includes('españa') || hay.includes('ermita') || hay.includes('sampaloc')) return 'Manila';
  // North CAMANAVA + south fringe (secondary markets).
  if (hay.includes('caloocan') || hay.includes('valenzuela') || hay.includes('malabon') || hay.includes('navotas') || hay.includes('camanava')) return 'CAMANAVA';
  if (hay.includes('las pinas') || hay.includes('las piñas') || hay.includes('bacoor') || hay.includes('zapote')) return 'Las Piñas';
  // --- Region XI (Davao) ---
  if (hay.includes('davao city') || hay.includes('lanang') || hay.includes('matina') || hay.includes('buhangin') || hay.includes('bajada') || hay.includes('toril') || hay.includes('agdao') || hay.includes('ecoland') || hay.includes('abreeza')) return 'Davao City';
  if (hay.includes('tagum') || hay.includes('digos') || hay.includes('panabo') || hay.includes('samal') || hay.includes('igacos') || hay.includes('mati')) return 'Davao Provinces';
  return null;
}

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
