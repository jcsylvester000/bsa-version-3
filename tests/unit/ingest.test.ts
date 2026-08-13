import { describe, it, expect } from 'vitest';
import {
  inPhBounds,
  normalizePoi, poiDedupKey,
  normalizeZonal, zonalNaturalKey,
  normalizeDemo,
  normalizeLease, leaseNaturalKey,
} from '@/lib/ingest/normalize';
import { normalizeMallName, brandUuid } from '@/lib/ingest/places';

describe('inPhBounds', () => {
  it('accepts Metro Manila coordinates', () => {
    expect(inPhBounds(14.55, 121.05)).toBe(true);
  });
  it('rejects coordinates outside PH', () => {
    expect(inPhBounds(40.7, -74)).toBe(false); // New York
    expect(inPhBounds(0, 0)).toBe(false);
  });
});

describe('normalizePoi', () => {
  it('normalizes a valid POI and keeps the Verified coord', () => {
    const n = normalizePoi({ osm_id: 5, name: 'Chatime', category: 'competitor', lat: 14.55, lon: 121.05 });
    expect(n).not.toBeNull();
    expect(n!.category).toBe('competitor');
    expect(n!.truthLayer).toBe('verified');
  });
  it('rejects out-of-bounds coordinates', () => {
    expect(normalizePoi({ name: 'X', lat: 51, lon: 0 })).toBeNull();
  });
  it('rejects a POI with no name', () => {
    expect(normalizePoi({ name: '  ', lat: 14.5, lon: 121 })).toBeNull();
  });
  it('coerces an unknown category to other', () => {
    expect(normalizePoi({ name: 'X', category: 'nonsense', lat: 14.5, lon: 121 })!.category).toBe('other');
  });
  it('dedups by osm_id when present, else name+coord', () => {
    const a = normalizePoi({ osm_id: 9, name: 'A', lat: 14.5, lon: 121 })!;
    const b = normalizePoi({ osm_id: 9, name: 'A copy', lat: 14.6, lon: 121.1 })!;
    expect(poiDedupKey(a)).toBe(poiDedupKey(b)); // same osm_id → same key
    const c = normalizePoi({ name: 'A', lat: 14.5, lon: 121 })!;
    expect(poiDedupKey(c)).toContain('nc:');
  });
});

describe('normalizeZonal', () => {
  it('classifies Verified when both bounds present, Assumed when partial', () => {
    const full = normalizeZonal({ region: 'NCR', city_municipality: 'Taguig', classification_code: 'CR', low_php_sqm: 50000, high_php_sqm: 90000 })!;
    expect(full.truthLayer).toBe('verified');
    const partial = normalizeZonal({ region: 'NCR', city_municipality: 'Pasig', classification_code: 'CR', low_php_sqm: 40000 })!;
    expect(partial.truthLayer).toBe('assumed');
  });
  it('rejects rows missing region/city/classification', () => {
    expect(normalizeZonal({ region: 'NCR' })).toBeNull();
  });
  it('builds a stable natural key', () => {
    const z = normalizeZonal({ region: 'NCR', city_municipality: 'Taguig', rdo: 'RDO 44', classification_code: 'CR', low_php_sqm: 1, high_php_sqm: 2 })!;
    expect(zonalNaturalKey(z)).toBe('NCR|Taguig|RDO 44|CR');
  });
});

describe('normalizeDemo', () => {
  it('requires a psgc_code', () => {
    expect(normalizeDemo({ population: 1000 })).toBeNull();
  });
  it('parses population and renter share', () => {
    const d = normalizeDemo({ psgc_code: '123', population: '38000', renter_share_pct: '62' })!;
    expect(d.population).toBe(38000);
    expect(d.renterSharePct).toBe(62);
    expect(d.truthLayer).toBe('verified');
  });
});

describe('normalizeLease', () => {
  it('requires format and corridor', () => {
    expect(normalizeLease({ corridor: 'BGC' })).toBeNull();
    expect(normalizeLease({ format: 'inline' })).toBeNull();
  });
  it('honours an explicit truth layer, defaults to assumed', () => {
    const v = normalizeLease({ format: 'inline', corridor: 'BGC', truth_layer: 'verified', base_rent_php_sqm: 2200 })!;
    expect(v.truthLayer).toBe('verified');
    expect(v.baseRentPhpSqm).toBe(2200);
    const d = normalizeLease({ format: 'kiosk', corridor: 'BGC' })!;
    expect(d.truthLayer).toBe('assumed');
  });
  it('builds a stable natural key including rate and date', () => {
    const l = normalizeLease({ format: 'inline', corridor: 'BGC', base_rent_php_sqm: 2200, observed_date: '2026-01-15' })!;
    expect(leaseNaturalKey(l)).toBe('inline|BGC||2200|2026-01-15');
  });
});

describe('normalizeMallName', () => {
  it('collapses Google name variants of the same mall', () => {
    expect(normalizeMallName('SM Megamall, Mandaluyong, Metro Manila')).toBe(normalizeMallName('SM Megamall'));
    expect(normalizeMallName('Ayala Malls the 30th')).toBe(normalizeMallName('Ayala Malls The 30th, Pasig'));
  });
  it('strips the "mall" token and punctuation', () => {
    expect(normalizeMallName('Gateway Mall 2')).toBe('gateway 2');
  });
});

describe('brandUuid', () => {
  it('is deterministic and RFC-4122 v4 shaped', () => {
    const a = brandUuid('jollibee');
    const b = brandUuid('jollibee');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('gives different brands different ids', () => {
    expect(brandUuid('jollibee')).not.toBe(brandUuid('chowking'));
  });
});
