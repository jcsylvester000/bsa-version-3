/**
 * R-04 — CSV parsing + tolerant census-row mapping.
 */
import { describe, it, expect } from 'vitest';
import { parseCsv, parseCsvRows } from '@/lib/util/csv';
import { demographicsRowFrom } from '@/lib/geo/demographicsRow';

describe('parseCsv', () => {
  it('parses a header + rows into keyed objects', () => {
    const recs = parseCsv('a,b,c\n1,2,3\n4,5,6\n');
    expect(recs).toEqual([{ a: '1', b: '2', c: '3' }, { a: '4', b: '5', c: '6' }]);
  });
  it('handles quoted fields with commas and doubled quotes', () => {
    const rows = parseCsvRows('name,pop\n"Santa Cruz, Poblacion",1000\n"He said ""hi""",5\n');
    expect(rows[1]).toEqual(['Santa Cruz, Poblacion', '1000']);
    expect(rows[2]).toEqual(['He said "hi"', '5']);
  });
  it('skips fully blank rows and returns [] for empty input', () => {
    expect(parseCsv('a,b\n\n1,2\n')).toEqual([{ a: '1', b: '2' }]);
    expect(parseCsv('')).toEqual([]);
  });
});

describe('demographicsRowFrom', () => {
  it('maps HDX COD-PS columns (ADM4_PCODE / T_TL)', () => {
    const r = demographicsRowFrom({ ADM4_PCODE: 'PH042101001', ADM4_EN: 'Amuyong', ADM3_EN: 'Alfonso', T_TL: '3,210' });
    expect(r).toEqual({ psgcCode: '042101001', barangay: 'Amuyong', city: 'Alfonso', population: 3210, incomeBand: null, daytimePop: null });
  });
  it('maps PSA-style columns (adm4_psgc / population)', () => {
    const r = demographicsRowFrom({ adm4_psgc: '0421010010', barangay: 'Poblacion', population: '12000', income_band: 'CD', daytime_pop: '15000' });
    expect(r?.population).toBe(12000);
    expect(r?.incomeBand).toBe('CD');
    expect(r?.daytimePop).toBe(15000);
  });
  it('loads a row even when population is missing (reported, not fabricated)', () => {
    const r = demographicsRowFrom({ psgc: '0421010011', barangay: 'X' });
    expect(r?.psgcCode).toBe('0421010011');
    expect(r?.population).toBeNull();
  });
  it('returns null with no PSGC code', () => {
    expect(demographicsRowFrom({ barangay: 'No code', population: '100' })).toBeNull();
  });
});
