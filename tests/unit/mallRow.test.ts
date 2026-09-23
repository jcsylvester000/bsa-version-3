/**
 * R-07 — mall-roster CSV row mapping (tier/footfall normalisation, region stamping, skip rules).
 */
import { describe, it, expect } from 'vitest';
import { mallRowFrom, canonicalTier, canonicalFootfall } from '@/lib/geo/mallRow';

describe('canonicalTier / canonicalFootfall', () => {
  it('normalises tier to A/B/C or null', () => {
    expect(canonicalTier('Tier A')).toBe('A');
    expect(canonicalTier('b')).toBe('B');
    expect(canonicalTier('super-regional')).toBeNull();
    expect(canonicalTier(null)).toBeNull();
  });
  it('normalises footfall band or null', () => {
    expect(canonicalFootfall('Very High')).toBe('very_high');
    expect(canonicalFootfall('high')).toBe('high');
    expect(canonicalFootfall('mid')).toBe('medium');
    expect(canonicalFootfall('busy')).toBeNull();
  });
});

describe('mallRowFrom', () => {
  it('maps a Cavite mall, stamping region IV-A + province, parsing coords', () => {
    const r = mallRowFrom(
      { name: 'SM City Bacoor', city: 'Bacoor', tier: 'A', footfall_band: 'very_high', lat: '14.4585', lon: '120.9430' },
      'cavite',
    );
    expect(r).toMatchObject({
      mall_name: 'SM City Bacoor', city: 'Bacoor', tier: 'A', footfall_band: 'very_high',
      lat: 14.4585, lon: 120.943, region: 'IV-A', province: 'Cavite', truth_layer: 'assumed',
    });
  });

  it('defaults truth_layer to assumed and keeps a verified mark', () => {
    expect(mallRowFrom({ mall_name: 'X', tier: 'B', footfall_band: 'high', truth_layer: 'verified' }, 'batangas')?.truth_layer).toBe('verified');
    expect(mallRowFrom({ mall_name: 'Y', tier: 'B', footfall_band: 'high' }, 'batangas')?.truth_layer).toBe('assumed');
  });

  it('stamps Batangas province', () => {
    expect(mallRowFrom({ mall_name: 'Robinsons Lipa', tier: 'B', footfall_band: 'high', lat: '13.94', lon: '121.16' }, 'batangas')?.province).toBe('Batangas');
  });

  it('returns null without a name, tier or footfall band (never fabricates a band)', () => {
    expect(mallRowFrom({ tier: 'A', footfall_band: 'high' }, 'cavite')).toBeNull();
    expect(mallRowFrom({ mall_name: 'Z', footfall_band: 'high' }, 'cavite')).toBeNull();
    expect(mallRowFrom({ mall_name: 'Z', tier: 'A' }, 'cavite')).toBeNull();
  });
});
