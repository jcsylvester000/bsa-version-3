/**
 * R-05 — BIR zonal CSV row mapping (tolerant columns, LGU canonicalisation, region stamping).
 */
import { describe, it, expect } from 'vitest';
import { zonalRowFrom, zonalRegionValue } from '@/lib/geo/zonalRow';

describe('zonalRegionValue', () => {
  it('maps region keys to their PSA region code', () => {
    expect(zonalRegionValue('ncr')).toBe('NCR');
    expect(zonalRegionValue('cavite')).toBe('IV-A');
    expect(zonalRegionValue('batangas')).toBe('IV-A');
    expect(zonalRegionValue('davao')).toBe('XI');
  });
});

describe('zonalRowFrom', () => {
  it('maps a Cavite CR row, canonicalising the LGU and stamping region IV-A', () => {
    const r = zonalRowFrom({ city: 'City of Bacoor', barangay: 'Molino IV', classification: 'CR', zonal_value: '9,500', rdo: '54B' }, 'cavite');
    expect(r).toMatchObject({
      region: 'IV-A', province: 'Cavite', city_municipality: 'Bacoor', barangay: 'Molino IV',
      classification_code: 'CR', low_php_sqm: 9500, high_php_sqm: 9500, rdo: '54B',
    });
  });

  it('supports separate low/high columns and a ₱ prefix', () => {
    const r = zonalRowFrom({ municipality: 'Imus', class: 'cc', low: '₱10,000', high: '₱14,000' }, 'cavite');
    expect(r?.classification_code).toBe('CC');
    expect(r?.low_php_sqm).toBe(10000);
    expect(r?.high_php_sqm).toBe(14000);
    expect(r?.barangay).toBe(''); // no barangay = city-grain
  });

  it('keeps an unrecognised LGU name as-is (still loads)', () => {
    const r = zonalRowFrom({ lgu: 'Some New Town', classification: 'CR', value: '5000' }, 'batangas');
    expect(r?.city_municipality).toBe('Some New Town');
    expect(r?.region).toBe('IV-A');
  });

  it('returns null without an LGU or without a classification', () => {
    expect(zonalRowFrom({ classification: 'CR', zonal_value: '100' }, 'cavite')).toBeNull();
    expect(zonalRowFrom({ city: 'Imus', zonal_value: '100' }, 'cavite')).toBeNull();
  });
});
