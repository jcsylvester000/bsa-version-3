import { describe, it, expect } from 'vitest';
import {
  canonicalNcrCity,
  bandMid,
  zonalRentCrossCheck,
  indicativeRentFromZonal,
  ZONAL_RENT_PER_1000_CENTRAL,
  ZONAL_RENT_PER_1000_LOW,
  ZONAL_RENT_PER_1000_HIGH,
} from '@/lib/modules/leaseMath';

describe('canonicalNcrCity', () => {
  it('maps common variants + landmarks to the canonical city', () => {
    expect(canonicalNcrCity('City of Pasig')).toBe('Pasig');
    expect(canonicalNcrCity(null, 'Ortigas Center, Pasig')).toBe('Pasig');
    expect(canonicalNcrCity('Makati City')).toBe('Makati');
    expect(canonicalNcrCity('Taguig', 'BGC')).toBe('Taguig');
    expect(canonicalNcrCity('Las Piñas City')).toBe('Las Piñas');
    expect(canonicalNcrCity(null, 'SM Mall of Asia')).toBe('Pasay');
    expect(canonicalNcrCity('Cubao')).toBe('Quezon City');
    expect(canonicalNcrCity('Binondo')).toBe('Manila');
  });
  it('returns null for an unknown / non-NCR place', () => {
    expect(canonicalNcrCity('Cebu City')).toBeNull();
    expect(canonicalNcrCity('', '')).toBeNull();
  });
});

describe('bandMid', () => {
  it('midpoints a low/high band', () => {
    expect(bandMid(10000, 30000)).toBe(20000);
  });
  it('falls back to whichever bound is present', () => {
    expect(bandMid(15000, null)).toBe(15000);
    expect(bandMid(null, 40000)).toBe(40000);
    expect(bandMid(null, null)).toBeNull();
  });
});

describe('zonalRentCrossCheck', () => {
  it('flags rent that is rich vs land value (above the ₱6–14 band)', () => {
    // rent 3000 / zonal mid 150000 * 1000 = 20 → rich
    const r = zonalRentCrossCheck(3000, 150000);
    expect(r.rentPer1000).toBeCloseTo(20, 1);
    expect(r.position).toBe('rich');
    expect(r.note).toContain('above');
  });
  it('flags rent that is thin vs land value (below the band)', () => {
    // rent 2000 / zonal mid 500000 * 1000 = 4 → thin (prime CBD case)
    const r = zonalRentCrossCheck(2000, 500000);
    expect(r.position).toBe('thin');
  });
  it('reads in line inside the band', () => {
    // rent 1800 / zonal mid 180000 * 1000 = 10 → inline
    const r = zonalRentCrossCheck(1800, 180000);
    expect(r.rentPer1000).toBeCloseTo(10, 1);
    expect(r.position).toBe('inline');
  });
  it('is unknown without inputs', () => {
    expect(zonalRentCrossCheck(null, 100000).position).toBe('unknown');
    expect(zonalRentCrossCheck(1000, null).position).toBe('unknown');
    expect(zonalRentCrossCheck(1000, 0).position).toBe('unknown');
  });
});

describe('indicativeRentFromZonal', () => {
  it('derives a wide band from the zonal midpoint using the calibrated ratios', () => {
    const ind = indicativeRentFromZonal(200000);
    expect(ind.lowPhpSqm).toBe(Math.round((ZONAL_RENT_PER_1000_LOW / 1000) * 200000)); // 1200
    expect(ind.midPhpSqm).toBe(Math.round((ZONAL_RENT_PER_1000_CENTRAL / 1000) * 200000)); // 2000
    expect(ind.highPhpSqm).toBe(Math.round((ZONAL_RENT_PER_1000_HIGH / 1000) * 200000)); // 2800
    expect(ind.lowPhpSqm!).toBeLessThan(ind.midPhpSqm!);
    expect(ind.midPhpSqm!).toBeLessThan(ind.highPhpSqm!);
  });
  it('is empty without a midpoint', () => {
    expect(indicativeRentFromZonal(null).midPhpSqm).toBeNull();
    expect(indicativeRentFromZonal(0).midPhpSqm).toBeNull();
  });
});
