/**
 * Pure normalization + dedup helpers for reference-data ingestion. No server
 * imports so they're unit-testable. Each loader normalizes source rows to the table
 * schema, assigns Truth Layer at the data layer, and dedups on a natural key.
 */

// PH bounds sanity — reject coordinates outside the country (a common source error).
export function inPhBounds(lat: number, lon: number): boolean {
  return lat >= 4 && lat <= 21 && lon >= 116 && lon <= 127;
}

export type TruthLayer = 'verified' | 'assumed' | 'projected';

// ---- POI (OSM Overpass) ----------------------------------------------------
export interface RawPoi {
  osm_id?: number | string | null;
  name?: string | null;
  category?: string | null;
  lat?: number | null;
  lon?: number | null;
  city?: string | null;
  barangay?: string | null;
}
export interface NormPoi {
  osmId: number | null;
  name: string;
  category: string;
  lat: number;
  lon: number;
  city: string | null;
  barangay: string | null;
  truthLayer: TruthLayer;
}

const POI_CATEGORIES = new Set([
  'competitor', 'anchor', 'transport', 'school', 'hospital', 'clinic',
  'diagnostic', 'mall', 'office', 'residential', 'other',
]);

export function normalizePoi(raw: RawPoi): NormPoi | null {
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !inPhBounds(lat, lon)) return null;
  const name = (raw.name ?? '').trim();
  if (!name) return null;
  const category = POI_CATEGORIES.has(String(raw.category)) ? String(raw.category) : 'other';
  const osmId = raw.osm_id != null && `${raw.osm_id}`.trim() !== '' ? Number(raw.osm_id) : null;
  return {
    osmId: Number.isFinite(osmId as number) ? (osmId as number) : null,
    name,
    category,
    lat,
    lon,
    city: raw.city?.trim() || null,
    // Coordinate is Verified from OSM; barangay derived by snap → Assumed.
    barangay: raw.barangay?.trim() || null,
    truthLayer: 'verified',
  };
}

/** Dedup POI by osm_id when present, else by name + rounded coord. */
export function poiDedupKey(p: NormPoi): string {
  if (p.osmId != null) return `osm:${p.osmId}`;
  return `nc:${p.name.toLowerCase()}:${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`;
}

// ---- Zonal (BIR RDO) -------------------------------------------------------
export interface RawZonal {
  region?: string | null;
  province?: string | null;
  city_municipality?: string | null;
  rdo?: string | null;
  classification_code?: string | null;
  low_php_sqm?: number | string | null;
  high_php_sqm?: number | string | null;
  notes?: string | null;
}
export interface NormZonal {
  region: string;
  province: string | null;
  cityMunicipality: string;
  rdo: string | null;
  classificationCode: string;
  lowPhpSqm: number | null;
  highPhpSqm: number | null;
  truthLayer: TruthLayer;
  notes: string | null;
}

export function normalizeZonal(raw: RawZonal): NormZonal | null {
  const region = raw.region?.trim();
  const city = raw.city_municipality?.trim();
  const cls = raw.classification_code?.trim();
  if (!region || !city || !cls) return null;
  const low = numOrNull(raw.low_php_sqm);
  const high = numOrNull(raw.high_php_sqm);
  return {
    region,
    province: raw.province?.trim() || null,
    cityMunicipality: city,
    rdo: raw.rdo?.trim() || null,
    classificationCode: cls,
    lowPhpSqm: low,
    highPhpSqm: high,
    // Verified when both bounds present; Assumed when partial.
    truthLayer: low != null && high != null ? 'verified' : 'assumed',
    notes: raw.notes?.trim() || null,
  };
}

export function zonalNaturalKey(z: NormZonal): string {
  return `${z.region}|${z.cityMunicipality}|${z.rdo ?? ''}|${z.classificationCode}`;
}

// ---- Demographics (PSA) ----------------------------------------------------
export interface RawDemo {
  psgc_code?: string | null;
  barangay?: string | null;
  city?: string | null;
  population?: number | string | null;
  income_band?: string | null;
  renter_share_pct?: number | string | null;
  daytime_pop?: number | string | null;
}
export interface NormDemo {
  psgcCode: string;
  barangay: string | null;
  city: string | null;
  population: number | null;
  incomeBand: string | null;
  renterSharePct: number | null;
  daytimePop: number | null;
  truthLayer: TruthLayer;
}

export function normalizeDemo(raw: RawDemo): NormDemo | null {
  const psgc = raw.psgc_code?.trim();
  if (!psgc) return null;
  return {
    psgcCode: psgc,
    barangay: raw.barangay?.trim() || null,
    city: raw.city?.trim() || null,
    population: intOrNull(raw.population),
    incomeBand: raw.income_band?.trim() || null,
    renterSharePct: numOrNull(raw.renter_share_pct),
    daytimePop: intOrNull(raw.daytime_pop),
    // PSA census Verified; daytime/projection Assumed.
    truthLayer: 'verified',
  };
}

// ---- Lease comps (broker / published corridor bands) ----------------------
export interface RawLease {
  format?: string | null;
  corridor?: string | null;
  mall_name?: string | null;
  base_rent_php_sqm?: number | string | null;
  escalation_pct?: number | string | null;
  cusa_php_sqm?: number | string | null;
  lease_term_years?: number | string | null;
  fitout_months?: number | string | null;
  observed_date?: string | null;
  truth_layer?: string | null;
  sample_source?: string | null;
}
export interface NormLease {
  format: string;
  corridor: string;
  mallName: string | null;
  baseRentPhpSqm: number | null;
  escalationPct: number | null;
  cusaPhpSqm: number | null;
  leaseTermYears: number | null;
  fitoutMonths: number | null;
  observedDate: string | null;
  truthLayer: TruthLayer;
  sampleSource: string | null;
}

export function normalizeLease(raw: RawLease): NormLease | null {
  const format = raw.format?.trim();
  const corridor = raw.corridor?.trim();
  if (!format || !corridor) return null;
  const tl = raw.truth_layer?.trim();
  const truthLayer: TruthLayer = tl === 'verified' || tl === 'assumed' || tl === 'projected' ? tl : 'assumed';
  return {
    format,
    corridor,
    mallName: raw.mall_name?.trim() || null,
    baseRentPhpSqm: numOrNull(raw.base_rent_php_sqm),
    escalationPct: numOrNull(raw.escalation_pct),
    cusaPhpSqm: numOrNull(raw.cusa_php_sqm),
    leaseTermYears: intOrNull(raw.lease_term_years),
    fitoutMonths: intOrNull(raw.fitout_months),
    observedDate: raw.observed_date?.trim() || null,
    truthLayer,
    sampleSource: raw.sample_source?.trim() || null,
  };
}

/** Natural key for a lease comp (format+corridor+mall+rate+date) — dedup only. */
export function leaseNaturalKey(l: NormLease): string {
  return `${l.format}|${l.corridor}|${l.mallName ?? ''}|${l.baseRentPhpSqm ?? ''}|${l.observedDate ?? ''}`;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v: unknown): number | null {
  const n = numOrNull(v);
  return n == null ? null : Math.round(n);
}
