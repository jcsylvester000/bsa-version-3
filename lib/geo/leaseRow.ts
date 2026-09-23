/**
 * R-06 — lease-comp CSV row mapping (tolerant columns, corridor canonicalisation, format
 * validation). Pure + client-safe so it can be unit-tested and reused by the loader.
 *
 * Turns one broker/published lease-comp CSV row into the `RawLease` the existing `loadLease`
 * ETL accepts. The corridor string is canonicalised to a registry corridor for the given region
 * (so "Bacoor", "Molino", "Imus" all land in the "Bacoor–Imus" corridor); an unrecognised
 * corridor is kept verbatim so it still loads (it simply won't be auto-inferred for a site yet).
 *
 * Truth Layer: a comp is only as strong as its source. Published corridor bands may be Verified;
 * a broker-supplied point is Assumed unless explicitly marked. We never invent a rate — a row
 * with no base rent AND no other term is dropped.
 */
import type { RawLease } from '@/lib/ingest/normalize';
import { getRegion, type RegionKey } from '@/lib/geo/regions';

/** Formats the app understands. Anything else is normalised to 'inline' (the safe default). */
const KNOWN_FORMATS = new Set(['inline', 'mall', 'highstreet', 'kiosk']);

type Rec = Record<string, string | number | null | undefined>;

/** First non-empty value among the given aliases (case-insensitive keys). */
function pick(rec: Rec, ...aliases: string[]): string | null {
  const lower: Record<string, string | number | null | undefined> = {};
  for (const k of Object.keys(rec)) lower[k.toLowerCase().trim()] = rec[k];
  for (const a of aliases) {
    const v = lower[a.toLowerCase()];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/** Strip ₱, commas and spaces, then parse. Null when absent/unparseable. */
function num(v: string | null): number | null {
  if (v == null) return null;
  const cleaned = v.replace(/[₱,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Normalise a free-text format to one the app reads. */
export function canonicalFormat(raw: string | null): string {
  const f = (raw ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (f === 'inline' || f === 'inlinestore' || f === 'street') return 'inline';
  if (f === 'mall' || f === 'mallgla' || f === 'anchor') return 'mall';
  if (f === 'highstreet' || f === 'high' || f === 'strip') return 'highstreet';
  if (f === 'kiosk' || f === 'cart' || f === 'pushcart') return 'kiosk';
  return KNOWN_FORMATS.has(f) ? f : 'inline';
}

/**
 * Canonical corridor name for a region. Matches the raw corridor text against the region's
 * corridor tokens (so an LGU or barangay name resolves to its corridor); falls back to a
 * loose name match, then to the raw text so nothing is silently dropped.
 */
export function canonicalCorridor(rawCorridor: string | null, regionKey: RegionKey): string | null {
  const region = getRegion(regionKey);
  if (!region) return rawCorridor;
  const hay = (rawCorridor ?? '').toLowerCase();
  if (!hay.trim()) return null;
  // Exact/loose name match first (the CSV usually already carries the corridor name).
  for (const c of region.corridors) {
    if (c.name.toLowerCase() === hay || hay.includes(c.name.toLowerCase())) return c.name;
  }
  // Then token match (an LGU/barangay string maps to its corridor).
  for (const c of region.corridors) {
    if (c.tokens.test(hay)) return c.name;
  }
  return rawCorridor; // keep as-is so it still loads
}

/** Truth Layer from the CSV, defaulting to Assumed (broker point) rather than Verified. */
function truthFrom(raw: string | null): 'verified' | 'assumed' | 'projected' {
  const t = (raw ?? '').toLowerCase().trim();
  return t === 'verified' || t === 'projected' ? t : 'assumed';
}

/**
 * Map one lease-comp CSV record for a region into a RawLease (or null to skip).
 * Skips a row without a corridor, or with no numeric term at all (never fabricate).
 */
export function leaseRowFrom(rec: Rec, regionKey: RegionKey): RawLease | null {
  const corridor = canonicalCorridor(pick(rec, 'corridor', 'area', 'submarket', 'lgu', 'city'), regionKey);
  if (!corridor) return null;

  const baseRent = num(pick(rec, 'base_rent_php_sqm', 'base_rent', 'rent', 'rent_php_sqm', 'php_sqm'));
  const escalation = num(pick(rec, 'escalation_pct', 'escalation', 'escal'));
  const cusa = num(pick(rec, 'cusa_php_sqm', 'cusa', 'dues'));
  const term = num(pick(rec, 'lease_term_years', 'term_years', 'term'));
  const fitout = num(pick(rec, 'fitout_months', 'fitout', 'fit_out_months'));
  // A comp with no numeric term carries no information — drop it.
  if (baseRent == null && escalation == null && cusa == null && term == null && fitout == null) return null;

  return {
    format: canonicalFormat(pick(rec, 'format', 'store_format', 'type')),
    corridor,
    mall_name: pick(rec, 'mall_name', 'mall', 'property'),
    base_rent_php_sqm: baseRent,
    escalation_pct: escalation,
    cusa_php_sqm: cusa,
    lease_term_years: term,
    fitout_months: fitout,
    observed_date: pick(rec, 'observed_date', 'date', 'as_of'),
    truth_layer: truthFrom(pick(rec, 'truth_layer', 'truth', 'confidence')),
    sample_source: pick(rec, 'sample_source', 'source', 'broker', 'notes'),
  };
}
