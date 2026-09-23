/**
 * R-02 — boundary feature → row mapping (tolerant of PSGC/OCHA property-name variants).
 */
import { describe, it, expect } from 'vitest';
import { boundaryFeatureToRow, normalizePsgc } from '@/lib/geo/boundaryFeature';

describe('normalizePsgc', () => {
  it('keeps digits and preserves leading zeros as text', () => {
    expect(normalizePsgc('042100000')).toBe('042100000');
    expect(normalizePsgc('PH042100000')).toBe('042100000');
    expect(normalizePsgc(' 04-21-00-000 ')).toBe('042100000'); // separators + spaces stripped
    expect(normalizePsgc('')).toBeNull();
    expect(normalizePsgc(null)).toBeNull();
  });
});

describe('boundaryFeatureToRow', () => {
  it('maps a barangay (adm4_* schema) with its parent city', () => {
    const row = boundaryFeatureToRow(
      { adm4_psgc: '0421010001', adm4_en: 'Alima', adm3_psgc: '0421010000', adm2_en: 'Cavite' },
      'barangay',
    );
    expect(row).toEqual({ psgcCode: '0421010001', level: 'barangay', name: 'Alima', parentPsgc: '0421010000' });
  });

  it('maps a city (ADM3_* uppercase schema)', () => {
    const row = boundaryFeatureToRow(
      { ADM3_PCODE: '0421010000', ADM3_EN: 'Bacoor', ADM2_PCODE: '0421000000' },
      'city',
    );
    expect(row).toEqual({ psgcCode: '0421010000', level: 'city', name: 'Bacoor', parentPsgc: '0421000000' });
  });

  it('maps a province with no parent', () => {
    const row = boundaryFeatureToRow({ adm2_psgc: '0421000000', adm2_en: 'Cavite' }, 'province');
    expect(row).toEqual({ psgcCode: '0421000000', level: 'province', name: 'Cavite', parentPsgc: null });
  });

  it('falls back to generic keys (psgc/name)', () => {
    const row = boundaryFeatureToRow({ psgc: '1012345678', name: 'Somewhere' }, 'barangay');
    expect(row?.psgcCode).toBe('1012345678');
    expect(row?.name).toBe('Somewhere');
  });

  it('returns null when no code or no name is present', () => {
    expect(boundaryFeatureToRow({ adm4_en: 'No Code' }, 'barangay')).toBeNull();
    expect(boundaryFeatureToRow({ adm4_psgc: '0421010001' }, 'barangay')).toBeNull();
    expect(boundaryFeatureToRow({}, 'city')).toBeNull();
  });
});
