/**
 * Pure math for the P2/P3 modules — deterministic, testable, no server imports.
 * Each function computes a score/verdict from inputs the server module retrieves.
 * Truth Layer is assigned by the server module per the architecture's per-module
 * classification (e.g. Daypart peak-hour mix is Projected; Mall tier is Verified).
 */

// ---- Daypart & Seasonality (P3) --------------------------------------------
export interface DaypartInput {
  /** Residential vs daytime population in the catchment. */
  residentialPop: number;
  daytimePop: number;
  /** The format's target window: 'day' (offices/lunch) or 'evening'/'allday'. */
  targetWindow: 'day' | 'evening' | 'allday';
}
export interface DaypartResult {
  daytimeShare: number; // 0–100, share of catchment activity that is daytime
  windowMatchPct: number; // 0–100, how much of demand falls in the target window
  verdict: 'well_matched' | 'partial' | 'mismatched';
  /** 24-value normalized demand curve (0–100 per hour) — persisted so every consumer
   *  (report, API, dashboard) shows the SAME curve, not a UI-only reconstruction. */
  hourly: number[];
  /** Hour (0–23) of peak demand. */
  peakHour: number;
}

// ---- Daypart SEASONALITY (the "& Seasonality" half of the feature) ----------
// Time-of-day is only half the demand story; NCR demand also swings by SEASON
// (Christmas peak, Undas/Holy Week exodus dip) and by vertical term-time (education
// follows the academic calendar; leisure corridors swing with tourism). This produces a
// Projected seasonality read from the corridor's seeded seasonal multipliers plus a
// vertical-specific term-time note. No live counts — a modelled swing, labelled Projected.

export interface SeasonSwing { season: string; low: number; high: number; label: string }
export interface DaypartSeasonality {
  /** Peak season and its demand multiplier band vs a normal weekday. */
  peakSeason: { season: string; label: string; low: number; high: number } | null;
  /** Trough season (biggest dip). */
  troughSeason: { season: string; label: string; low: number; high: number } | null;
  /** Vertical term-time sensitivity note (e.g. education → academic calendar). */
  termTimeNote: string | null;
  /** All seasons as multiplier bands, for the UI. */
  swings: SeasonSwing[];
  truthLayer: 'projected';
}

const TERM_TIME_NOTE: Record<string, string> = {
  education: 'Term-time sensitive — demand tracks the academic calendar; expect a June–March lift and a April–May trough.',
  fnb_cafe: 'Campus/office cafés dip during term breaks and the Holy Week / Undas exodus.',
  hotel: 'Tourism-driven — peaks over long weekends, Christmas and summer (Mar–May); mid-week troughs.',
  services_fitness: 'New-Year resolution and pre-summer (Jan, Mar–Apr) enrolment spikes; ber-months dip.',
};

/**
 * Build a Projected seasonality read for a site from its corridor's seasonal multiplier map
 * (as seeded in traffic_corridor) and the vertical. Returns the peak/trough seasons and a
 * term-time note. When no corridor seasonal data is available, returns a term-time-only read.
 */
export function daypartSeasonality(
  vertical: string,
  seasonal: Record<string, { low: number; high: number; label?: string }> | null | undefined,
): DaypartSeasonality {
  const termTimeNote = TERM_TIME_NOTE[vertical] ?? null;
  if (!seasonal || Object.keys(seasonal).length === 0) {
    return { peakSeason: null, troughSeason: null, termTimeNote, swings: [], truthLayer: 'projected' };
  }
  const swings: SeasonSwing[] = Object.entries(seasonal).map(([season, f]) => ({
    season, low: f.low, high: f.high, label: f.label ?? season,
  }));
  // Peak = highest 'high' multiplier; trough = lowest 'low'. Skip 'normal' (baseline 1.0).
  const nonNormal = swings.filter((s) => s.season !== 'normal');
  const peak = nonNormal.reduce<SeasonSwing | null>((best, s) => (!best || s.high > best.high ? s : best), null);
  const trough = nonNormal.reduce<SeasonSwing | null>((worst, s) => (!worst || s.low < worst.low ? s : worst), null);
  return {
    peakSeason: peak ? { season: peak.season, label: peak.label, low: peak.low, high: peak.high } : null,
    troughSeason: trough ? { season: trough.season, label: trough.label, low: trough.low, high: trough.high } : null,
    termTimeNote,
    swings,
    truthLayer: 'projected',
  };
}

/**
 * Build a 24h demand curve from the daytime share: an office-led catchment peaks at
 * midday (~12–13h), a residential catchment peaks in the evening (~19h). Two gaussians
 * weighted by the share. Normalized 0–100. Pure + deterministic.
 */
export function daypartCurve(daytimeShare: number): number[] {
  const officeW = Math.max(0, Math.min(1, daytimeShare / 100));
  const homeW = 1 - officeW;
  const g = (h: number, mu: number, sd: number) => Math.exp(-((h - mu) ** 2) / (2 * sd * sd));
  const arr: number[] = [];
  for (let h = 0; h < 24; h++) {
    const v = officeW * g(h, 12.5, 2.4) + homeW * g(h, 19, 2.6) + 0.05 * g(h, 8, 1.5);
    arr.push(Math.round(v * 100));
  }
  const max = Math.max(...arr) || 1;
  return arr.map((v) => Math.round((v / max) * 100));
}

export function scoreDaypart(input: DaypartInput): DaypartResult {
  const total = input.residentialPop + input.daytimePop;
  const daytimeShare = total > 0 ? Math.round((input.daytimePop / total) * 1000) / 10 : 0;
  let windowMatchPct: number;
  if (input.targetWindow === 'day') windowMatchPct = daytimeShare;
  else if (input.targetWindow === 'evening') windowMatchPct = Math.round((100 - daytimeShare) * 10) / 10;
  else windowMatchPct = 100 - Math.abs(50 - daytimeShare); // allday best when balanced
  windowMatchPct = Math.max(0, Math.min(100, windowMatchPct));
  const verdict = windowMatchPct >= 60 ? 'well_matched' : windowMatchPct >= 40 ? 'partial' : 'mismatched';
  const hourly = daypartCurve(daytimeShare);
  const peakHour = hourly.indexOf(Math.max(...hourly));
  return { daytimeShare, windowMatchPct, verdict, hourly, peakHour };
}

// ---- Informal-Competitor Capture (P3) --------------------------------------
export interface InformalInput {
  digitalCount: number; // Verified competitor POIs
  /** Estimated informal multiplier for the format (e.g. salons ~1.5x). */
  informalMultiplier: number;
}
export interface InformalResult {
  digitalCount: number;
  estimatedInformal: number; // Assumed
  totalEstimated: number;
  onGroundCheckAdvised: boolean;
}
export function scoreInformal(input: InformalInput): InformalResult {
  const estimatedInformal = Math.round(input.digitalCount * Math.max(0, input.informalMultiplier - 1));
  const totalEstimated = input.digitalCount + estimatedInformal;
  return {
    digitalCount: input.digitalCount,
    estimatedInformal,
    totalEstimated,
    // If informal is a large share, advise an on-ground check (honesty flag).
    onGroundCheckAdvised: estimatedInformal >= input.digitalCount,
  };
}

// ---- Per-unit capacity read (QA v6) ----------------------------------------
// Salon (chairs), laundry (machines), water station (refill lines) all care about
// how many people the local catchment supports PER service unit — and whether the
// catchment clears a rough breakeven household count. This turns the "units" intake
// field + local population into a first-class pop-per-unit + breakeven read.
export interface CapacityInput {
  /** Number of service units the operator plans (chairs / machines / lines). */
  units: number | null;
  /** Resident population in the tight service catchment. */
  catchmentPop: number | null;
  /** Households implied (pop / avg household size). */
  avgHouseholdSize?: number;
  /** Households needed per unit to break even (format assumption). */
  breakevenHouseholdsPerUnit?: number;
}
export interface CapacityResult {
  units: number | null;
  popPerUnit: number | null;
  households: number | null;
  breakevenHouseholds: number | null;
  clearsBreakeven: boolean | null;
  verdict: 'unknown' | 'below_breakeven' | 'thin' | 'healthy';
  flags: string[];
}
export function scoreCapacity(input: CapacityInput): CapacityResult {
  const hhSize = input.avgHouseholdSize ?? 4.1; // PSA NCR ~4.1 persons/household
  const bePerUnit = input.breakevenHouseholdsPerUnit ?? 350;
  const flags: string[] = [];
  if (input.units == null) flags.push('no_unit_count');
  if (input.catchmentPop == null) flags.push('no_catchment_pop');
  if (input.units == null || input.catchmentPop == null) {
    return { units: input.units, popPerUnit: null, households: null, breakevenHouseholds: null, clearsBreakeven: null, verdict: 'unknown', flags };
  }
  const units = Math.max(1, input.units);
  const households = Math.round(input.catchmentPop / hhSize);
  const popPerUnit = Math.round(input.catchmentPop / units);
  const breakevenHouseholds = bePerUnit * units;
  const clearsBreakeven = households >= breakevenHouseholds;
  let verdict: CapacityResult['verdict'];
  if (!clearsBreakeven) { verdict = 'below_breakeven'; flags.push('below_breakeven'); }
  else if (households < breakevenHouseholds * 1.5) verdict = 'thin';
  else verdict = 'healthy';
  return { units, popPerUnit, households, breakevenHouseholds, clearsBreakeven, verdict, flags };
}

// ---- Mall Intelligence (P2) ------------------------------------------------
export interface MallInput {
  tier: 'A' | 'B' | 'C';
  footfallBand: 'very_high' | 'high' | 'medium' | 'low';
}
export interface MallResult {
  score: number; // 0–100 composite from tier + footfall
  verdict: 'prime' | 'solid' | 'secondary';
}
const TIER_SCORE = { A: 100, B: 70, C: 40 } as const;
const FOOTFALL_SCORE = { very_high: 100, high: 80, medium: 55, low: 30 } as const;
export function scoreMall(input: MallInput): MallResult {
  const score = Math.round((TIER_SCORE[input.tier] * 0.6 + FOOTFALL_SCORE[input.footfallBand] * 0.4) * 10) / 10;
  const verdict = score >= 80 ? 'prime' : score >= 55 ? 'solid' : 'secondary';
  return { score, verdict };
}

// ---- Healthcare Proximity (P2) ---------------------------------------------
export interface HealthcareInput {
  /** Distance to the nearest referral facility (hospital/clinic), metres. */
  nearestFacilityM: number | null;
  facilityCountWithin2km: number;
  /**
   * Residential catchment demographics (the "score on catchment AND referral sources" half
   * from F3). All optional — when absent the score falls back to proximity only.
   */
  catchmentPopulation?: number | null;
  /** Income band of the catchment (AB / BC / CD / DE). */
  incomeBand?: string | null;
  /** Share of the catchment aged 45+ (0–100), the healthcare-demand-relevant cohort. */
  age45PlusPct?: number | null;
}
export interface HealthcareResult {
  proximityScore: number;   // 0–100, referral-source proximity/density (Verified locations)
  catchmentScore: number | null; // 0–100, residential catchment demand (Projected)
  composite: number;        // 0–100, blended
  verdict: 'strong' | 'moderate' | 'weak' | 'no_data';
  catchmentNote: string | null;
}

/** Map an income band to a healthcare spending-power weight (0–1). Higher band = higher
 *  private-healthcare/pharmacy spend per capita. Documented assumption (Projected). */
function incomeWeight(band: string | null | undefined): number {
  switch ((band ?? '').toUpperCase()) {
    case 'AB': return 1.0;
    case 'BC': return 0.85;
    case 'CD': return 0.65;
    case 'DE': return 0.45;
    default: return 0.6;
  }
}

export function scoreHealthcare(input: HealthcareInput): HealthcareResult {
  if (input.nearestFacilityM == null) {
    return { proximityScore: 0, catchmentScore: null, composite: 0, verdict: 'no_data', catchmentNote: null };
  }
  // Referral-source proximity (Verified locations): 100 at 0 m, 0 at >=3 km, + density bonus.
  const distScore = Math.max(0, 100 - (input.nearestFacilityM / 3000) * 100);
  const densityBonus = Math.min(20, input.facilityCountWithin2km * 5);
  const proximityScore = Math.round(Math.min(100, distScore + densityBonus) * 10) / 10;

  // Residential CATCHMENT demand (Projected): population depth × income spending-power ×
  // an older-skew bonus (45+ cohort consumes more healthcare/pharmacy). Only computed when
  // we have catchment data — otherwise the score stays proximity-only (backward compatible).
  let catchmentScore: number | null = null;
  let catchmentNote: string | null = null;
  const pop = input.catchmentPopulation ?? null;
  if (pop != null && pop > 0) {
    // Population depth: saturating at ~150k in the catchment.
    const popScore = Math.min(100, (pop / 150000) * 100);
    const incW = incomeWeight(input.incomeBand);
    const age = input.age45PlusPct ?? null;
    // Age bonus: a catchment skewing older (45+ above ~30%) lifts healthcare demand.
    const ageBonus = age != null ? Math.max(0, Math.min(20, (age - 30) * 1.5)) : 0;
    catchmentScore = Math.round(Math.min(100, popScore * incW + ageBonus) * 10) / 10;
    const bandTxt = (input.incomeBand ?? '—').toUpperCase();
    catchmentNote = `${Math.round(pop).toLocaleString()} residents · income ${bandTxt}${age != null ? ` · ${Math.round(age)}% aged 45+` : ''}`;
  }

  // Composite: referral proximity 60% + catchment demand 40% when catchment is available.
  const composite = catchmentScore != null
    ? Math.round((proximityScore * 0.6 + catchmentScore * 0.4) * 10) / 10
    : proximityScore;

  const verdict = composite >= 70 ? 'strong' : composite >= 40 ? 'moderate' : 'weak';
  return { proximityScore, catchmentScore, composite, verdict, catchmentNote };
}

// ---- White-Space (P2) ------------------------------------------------------
export interface WhiteSpaceCell {
  psgcCode: string;
  barangay: string | null;
  population: number;
  /** Distance to nearest own outlet, metres (null = none nearby). */
  nearestOwnM: number | null;
  competitorCount: number;
  /** Barangay centroid, for plotting the gap on a map (optional). */
  lat?: number | null;
  lon?: number | null;
}
export interface WhiteSpaceGap {
  psgcCode: string;
  barangay: string | null;
  population: number;
  opportunityScore: number; // 0–100
  reason: string;
  /** Barangay centroid, carried through so the UI can pin the gap on a map. */
  lat?: number | null;
  lon?: number | null;
}
/**
 * Rank unserved high-density gaps. Opportunity rises with population and distance
 * from own network, falls with competitor density. Cells already well-served
 * (an own outlet within 800 m) are excluded.
 */
export function rankWhiteSpace(cells: WhiteSpaceCell[]): WhiteSpaceGap[] {
  const maxPop = Math.max(1, ...cells.map((c) => c.population));
  const gaps: WhiteSpaceGap[] = [];
  for (const c of cells) {
    if (c.nearestOwnM != null && c.nearestOwnM < 800) continue; // already served
    const popScore = (c.population / maxPop) * 60;
    const distScore = c.nearestOwnM == null ? 25 : Math.min(25, (c.nearestOwnM / 3000) * 25);
    const compPenalty = Math.min(30, c.competitorCount * 6);
    const opportunityScore = Math.round(Math.max(0, popScore + distScore - compPenalty + 15) * 10) / 10;
    gaps.push({
      psgcCode: c.psgcCode,
      barangay: c.barangay,
      population: c.population,
      opportunityScore,
      reason: `pop ${c.population.toLocaleString()}, ${c.nearestOwnM == null ? 'no own store nearby' : `${Math.round(c.nearestOwnM)} m to nearest own store`}, ${c.competitorCount} competitor(s)`,
      lat: c.lat ?? null,
      lon: c.lon ?? null,
    });
  }
  // Dedupe by barangay name (a barangay can have more than one demographic cell row from
  // overlapping ingests) — keep the highest-scoring instance so the ranked list never
  // shows the same barangay twice.
  const byName = new Map<string, WhiteSpaceGap>();
  for (const g of gaps) {
    const key = (g.barangay ?? g.psgcCode).toLowerCase();
    const prev = byName.get(key);
    if (!prev || g.opportunityScore > prev.opportunityScore) byName.set(key, g);
  }
  return [...byName.values()].sort((a, b) => b.opportunityScore - a.opportunityScore);
}
