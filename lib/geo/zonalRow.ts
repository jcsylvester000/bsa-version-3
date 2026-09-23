/**
 * Pure mapping from a BIR zonal CSV record to a RawZonal row (R-05). Tolerant of the column
 * names BIR/analyst exports use, canonicalises the LGU to the region registry so the lease
 * lookup aligns, and stamps the region (PSA region code) so a province's rows are keyed
 * consistently. No I/O — unit-tested in tests/unit/zonalRow.test.ts.
 */
import { canonicalCity, getRegion, type RegionKey } from './regions';
import type { RawZonal } from '@/lib/ingest/normalize';

type Rec = Record<string, unknown>;

const KEYS = {
  city: ['city', 'municipality', 'city_municipality', 'cityMunicipality', 'lgu', 'location', 'city/municipality'],
  barangay: ['barangay', 'brgy', 'Barangay', 'BARANGAY'],
  classification: ['classification_code', 'classification', 'class', 'zv_class', 'property_classification', 'CLASS'],
  low: ['low_php_sqm', 'low', 'min', 'zv_low'],
  high: ['high_php_sqm', 'high', 'max', 'zv_high'],
  value: ['zonal_value', 'zv', 'value_per_sqm', 'php_per_sqm', 'amount', 'value', 'zonal_value_per_sqm'],
  rdo: ['rdo', 'rdo_no', 'rdo_code', 'RDO'],
  notes: ['notes', 'remarks', 'note'],
};

function pick(rec: Rec, candidates: string[]): string | null {
  for (const k of candidates) {
    const v = rec[k];
    if (v != null && `${v}`.trim() !== '') return `${v}`.trim();
  }
  return null;
}

function numOrNull(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/[₱,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** The zonal `region` value BSA stores/queries for a region key (its PSA region code). */
export function zonalRegionValue(regionKey: RegionKey): string {
  return getRegion(regionKey)?.psaRegion ?? 'NCR';
}

/**
 * Map one CSV record to a RawZonal for `regionKey`. Returns null without a city + classification.
 * The LGU is canonicalised to the registry (so 'City of Bacoor' → 'Bacoor', matching the lookup);
 * an unrecognised LGU keeps its raw name (logged upstream). A single value column fills low+high.
 */
export function zonalRowFrom(rec: Rec, regionKey: RegionKey): RawZonal | null {
  const rawCity = pick(rec, KEYS.city);
  const cls = pick(rec, KEYS.classification);
  if (!rawCity || !cls) return null;
  const canon = canonicalCity(rawCity);
  const city = canon && canon.region === regionKey ? canon.city : rawCity;
  let low = numOrNull(pick(rec, KEYS.low));
  let high = numOrNull(pick(rec, KEYS.high));
  if (low == null && high == null) {
    const single = numOrNull(pick(rec, KEYS.value));
    if (single != null) { low = single; high = single; }
  }
  return {
    region: zonalRegionValue(regionKey),
    province: getRegion(regionKey)?.provinces[0] ?? null,
    city_municipality: city,
    barangay: pick(rec, KEYS.barangay) ?? '',
    rdo: pick(rec, KEYS.rdo) ?? '',
    classification_code: cls.toUpperCase(),
    low_php_sqm: low,
    high_php_sqm: high,
    notes: pick(rec, KEYS.notes),
  };
}
