/**
 * Land & Traffic (F4) — pure math for the land-acquisition screen. Land-intensive
 * formats (fuel, automotive, hotel) are screened on vehicle traffic, road frontage,
 * lot geometry and zoning up front — not mall footfall.
 *
 * Truth Layer per the architecture: zoning and frontage are Verified; vehicle-traffic
 * counts are Assumed unless a source count exists.
 */

export interface LandInput {
  /** Estimated vehicle traffic band on the fronting corridor. */
  trafficBand: 'very_high' | 'high' | 'medium' | 'low' | 'unknown';
  /** Road frontage in metres (null = not supplied). */
  frontageM: number | null;
  /** Lot area in sqm (null = not supplied). */
  lotAreaSqm: number | null;
  /** Whether zoning permits the format (true/false/null unknown). */
  zoningOk: boolean | null;
  /** Minimum frontage/area the format needs. */
  minFrontageM: number;
  minLotSqm: number;
}

export interface LandResult {
  trafficScore: number; // 0–100
  frontageScore: number | null; // 0–100
  lotScore: number | null; // 0–100
  composite: number; // 0–100
  zoningOk: boolean | null;
  verdict: 'screen_pass' | 'marginal' | 'screen_fail';
  flags: string[];
}

const TRAFFIC_SCORE: Record<string, number> = { very_high: 100, high: 80, medium: 55, low: 30, unknown: 40 };

export function scoreLandTraffic(input: LandInput): LandResult {
  const trafficScore = TRAFFIC_SCORE[input.trafficBand] ?? 40;

  const frontageScore = input.frontageM == null ? null
    : clamp((input.frontageM / Math.max(1, input.minFrontageM)) * 60);
  const lotScore = input.lotAreaSqm == null ? null
    : clamp((input.lotAreaSqm / Math.max(1, input.minLotSqm)) * 60);

  // Weighted composite over available pillars.
  const parts: Array<{ v: number; w: number }> = [{ v: trafficScore, w: 0.45 }];
  if (frontageScore != null) parts.push({ v: frontageScore, w: 0.3 });
  if (lotScore != null) parts.push({ v: lotScore, w: 0.25 });
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  let composite = Math.round((parts.reduce((s, p) => s + p.v * p.w, 0) / totalW) * 10) / 10;

  const flags: string[] = [];
  // Zoning is a hard gate: a failing zone caps the screen regardless of traffic.
  if (input.zoningOk === false) { composite = Math.min(composite, 25); flags.push('zoning_fails'); }
  if (input.zoningOk == null) flags.push('zoning_unconfirmed');
  if (input.trafficBand === 'unknown') flags.push('traffic_count_assumed');
  if (input.frontageM != null && input.frontageM < input.minFrontageM) flags.push('frontage_below_minimum');
  if (input.lotAreaSqm != null && input.lotAreaSqm < input.minLotSqm) flags.push('lot_below_minimum');

  const verdict = input.zoningOk === false ? 'screen_fail'
    : composite >= 65 ? 'screen_pass'
    : composite >= 45 ? 'marginal' : 'screen_fail';

  return { trafficScore, frontageScore, lotScore, composite, zoningOk: input.zoningOk, verdict, flags };
}

function clamp(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
}

// ============================================================================
// NCR corridor traffic seasonality (Projected)
// ----------------------------------------------------------------------------
// The base traffic band above is the ordinary-weekday read. Commercial demand on a
// corridor swings by NCR season — Christmas ("carmageddon") lifts retail footfall,
// Undas and Holy Week pull an intra-NCR dip (exodus to the provinces) except on
// cemetery-adjacent corridors that spike during Undas. These helpers turn the seeded
// per-corridor multipliers into a low/high demand-index range so the Land screen shows
// a season-aware band, not a single point. Modelled — Projected — never a live count.
// ============================================================================

/** One season's multiplier band, as seeded per corridor. */
export interface SeasonFactor { low: number; high: number; truthLayer?: string; label?: string }
export type CorridorSeasonal = Record<string, SeasonFactor>;

/** The NCR seasons the dataset carries, in a sensible display order. */
export const TRAFFIC_SEASONS = [
  'normal', 'payday', 'school_open', 'holiday', 'christmas', 'undas', 'holy_week',
] as const;
export type TrafficSeason = typeof TRAFFIC_SEASONS[number];

/** Map a FootfallBand to a 0–100 base demand index (mirrors TRAFFIC_SCORE ordering). */
export function bandBaseIndex(band: string): number {
  return band === 'very_high' ? 62 : band === 'high' ? 52 : band === 'medium' ? 40 : band === 'low' ? 24 : 34;
}

/**
 * Build a season → {low, high} demand-index range for a corridor from its base band and
 * seeded multipliers. Values are clamped to 0–100. When a season is missing it falls back
 * to the base index (multiplier 1.0).
 */
export function seasonalDemandRange(baseBand: string, seasonal: CorridorSeasonal | null | undefined):
  Array<{ season: TrafficSeason; low: number; high: number; label: string }> {
  const base = bandBaseIndex(baseBand);
  return TRAFFIC_SEASONS.map((season) => {
    const f = seasonal?.[season];
    const lo = f ? f.low : 1.0;
    const hi = f ? f.high : 1.0;
    return {
      season,
      low: clamp(base * lo),
      high: clamp(base * hi),
      label: f?.label ?? season,
    };
  });
}

/** Current NCR season from a month (1–12) and day — for the "today" highlight in the UI. */
export function currentSeason(month: number, day: number): TrafficSeason {
  // Undas window: Oct 30 – Nov 2.
  if ((month === 10 && day >= 30) || (month === 11 && day <= 2)) return 'undas';
  // Christmas / ber-months peak: Nov 15 – Jan 6.
  if ((month === 11 && day >= 15) || month === 12 || (month === 1 && day <= 6)) return 'christmas';
  // Payday windows (around 15th and month-end).
  if (day >= 14 && day <= 16) return 'payday';
  if (day >= 29 || day <= 1) return 'payday';
  // School term-open uplift (June & August starts, PH academic calendar).
  if ((month === 6 || month === 8) && day <= 15) return 'school_open';
  return 'normal';
}
