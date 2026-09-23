/**
 * R-07 — mall-roster CSV row mapping (tolerant columns, tier/footfall normalisation, region
 * stamping). Pure + client-safe so it can be unit-tested and reused by the loader.
 *
 * Turns one mall-roster CSV row into the `RawMall` the existing `loadMalls` ETL accepts. Stamps
 * the region's PSA code + province so provincial malls are tagged. `loadMalls` still enforces the
 * hard rules (a row with an unknown tier or footfall band is skipped, never fabricated to a
 * default), and geom is built from lat/lon — a mall without coordinates loads but won't be found
 * by the nearest-mall spatial query, so the README asks for lat/lon.
 */
import type { RawMall } from '@/lib/ingest/loaders';
import { getRegion, type RegionKey } from '@/lib/geo/regions';

type Rec = Record<string, string | number | null | undefined>;

function pick(rec: Rec, ...aliases: string[]): string | null {
  const lower: Record<string, string | number | null | undefined> = {};
  for (const k of Object.keys(rec)) lower[k.toLowerCase().trim()] = rec[k];
  for (const a of aliases) {
    const v = lower[a.toLowerCase()];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

function numOrNull(v: string | null): number | null {
  if (v == null) return null;
  const n = Number(v.replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalise a mall tier to A/B/C. Accepts a bare letter or a "Tier A …" prefix, but not a stray
 * A/B/C buried in a word ("super-regional" → null, not 'A'). Returns null → the row is skipped.
 */
export function canonicalTier(raw: string | null): string | null {
  const m = (raw ?? '').match(/(?:^|\btier\s*)([abc])\b/i);
  return m ? m[1].toUpperCase() : null;
}

/** Normalise a free-text footfall band to the enum. Returns null for anything else. */
export function canonicalFootfall(raw: string | null): string | null {
  const f = (raw ?? '').toLowerCase().replace(/[\s-]/g, '_');
  if (['very_high', 'veryhigh', 'vhigh'].includes(f)) return 'very_high';
  if (f === 'high') return 'high';
  if (['medium', 'mid', 'med'].includes(f)) return 'medium';
  if (f === 'low') return 'low';
  return null;
}

/**
 * Map one mall-roster CSV record for a region into a RawMall (or null to skip).
 * Skips a row without a name, tier or footfall band — those cannot be inferred honestly.
 */
export function mallRowFrom(rec: Rec, regionKey: RegionKey): RawMall | null {
  const name = pick(rec, 'mall_name', 'mall', 'name', 'property');
  const tier = canonicalTier(pick(rec, 'tier', 'mall_tier', 'grade'));
  const footfall = canonicalFootfall(pick(rec, 'footfall_band', 'footfall', 'traffic_band'));
  if (!name || !tier || !footfall) return null;

  const region = getRegion(regionKey);
  const tl = (pick(rec, 'truth_layer', 'truth', 'confidence') ?? '').toLowerCase();
  return {
    mall_name: name,
    city: pick(rec, 'city', 'lgu', 'municipality'),
    tier,
    footfall_band: footfall,
    rent_band_php_sqm: pick(rec, 'rent_band_php_sqm', 'rent_band', 'rent'),
    cusa_band: pick(rec, 'cusa_band', 'cusa', 'dues'),
    lat: numOrNull(pick(rec, 'lat', 'latitude', 'y')),
    lon: numOrNull(pick(rec, 'lon', 'lng', 'longitude', 'x')),
    region: region?.psaRegion ?? null,
    province: region?.provinces[0] ?? null,
    truth_layer: tl === 'verified' || tl === 'projected' ? tl : 'assumed',
  };
}
