/**
 * Brief alignment Batch 2 (2026-11-04) — Truth Layer per field, 10-digit PSGC codes, outlet sources,
 * map legend, test-account exclusion.
 */
import { describe, it, expect } from 'vitest';
import { psgc10, psgcFileCode } from '@/lib/geo/psgcCode';
import { boundaryFeatureToRow } from '@/lib/geo/boundaryFeature';
import { demographicsRowFrom, censusYearFrom } from '@/lib/geo/demographicsRow';
import { censusSourceLabel, populationTruthOf } from '@/lib/geo/censusMeta';
import { outletRowFrom } from '@/lib/geo/outletRow';
import { outletLegend } from '@/lib/geo/mapGeometry';
import { isTestAccountEmail } from '@/lib/data/testAccounts';

describe('PSGC codes are 10 digits (T-3)', () => {
  it('restores the leading zero the boundary maps drop', () => {
    expect(psgc10(402101006)).toBe('0402101006');      // JSON number from the maps
    expect(psgc10('402101006')).toBe('0402101006');    // same code as text
    expect(psgc10('PH0402101006')).toBe('0402101006');
    expect(psgc10(1380600000)).toBe('1380600000');     // NCR codes already 10 digits
    expect(psgc10('042101001')).toBe('042101001');     // pre-2019 9-digit scheme kept as written
    expect(psgc10(null)).toBeNull();
    expect(psgc10('')).toBeNull();
  });
  it('file names use the integer form', () => {
    expect(psgcFileCode('0402100000')).toBe('402100000');
    expect(psgcFileCode('1380600000')).toBe('1380600000');
  });
  it('a City of Manila barangay feature (latest maps) maps to a 10-digit row under its city', () => {
    const row = boundaryFeatureToRow(
      { adm1_psgc: 1300000000, adm2_psgc: 1303900000, adm3_psgc: 1380600000, adm4_psgc: 1303901906, adm4_en: 'Manila North Cemetery', geo_level: null },
      'barangay',
    );
    expect(row).toEqual({ psgcCode: '1303901906', level: 'barangay', name: 'Manila North Cemetery', parentPsgc: '1380600000' });
  });
  it('a Cavite barangay keys to the same code a census file uses', () => {
    const b = boundaryFeatureToRow({ adm3_psgc: 402101000, adm4_psgc: 402101006, adm4_en: 'Kaingin' }, 'barangay');
    const d = demographicsRowFrom({ ADM4_PCODE: 'PH0402101006', T_TL: '1000' });
    expect(b?.psgcCode).toBe('0402101006');
    expect(d?.psgcCode).toBe(b?.psgcCode);
    expect(b?.parentPsgc).toBe('0402101000');
  });
});

describe('Census population labels (T-1 / T-4)', () => {
  it('reads the census year from the population column', () => {
    expect(censusYearFrom({ pop_2020: '100' })).toBe(2020);
    expect(censusYearFrom({ pop_2024: '100', pop_2020: '90' })).toBe(2024);
    expect(censusYearFrom({ T_TL: '100' })).toBeNull();
    expect(demographicsRowFrom({ psgc: '1380100001', pop_2024: '1,234' })).toMatchObject({ population: 1234, censusYear: 2024 });
  });
  it('names the source in plain words', () => {
    expect(censusSourceLabel(2020)).toBe('PSA 2020 Census (CPH)');
    expect(censusSourceLabel(2024)).toBe('PSA 2024 Census (POPCEN)');
    expect(censusSourceLabel(null)).toBe('PSA Census');
  });
  it('a summed population is as strong as its weakest cell', () => {
    expect(populationTruthOf(['verified', 'verified'])).toBe('verified');
    expect(populationTruthOf(['verified', 'assumed'])).toBe('assumed');
    expect(populationTruthOf(['projected', 'verified'])).toBe('projected');
    expect(populationTruthOf([])).toBeNull();
  });
});

describe('Brand-supplied outlet lists (T-5)', () => {
  it('maps common columns and keeps sales only as a number', () => {
    const r = outletRowFrom({ branch_name: 'One Ayala', latitude: '14.5503', longitude: '121.0266', format: 'Mall', monthly_sales: '₱408,240' });
    expect(r).toEqual({ row: { outletName: 'One Ayala', lat: 14.5503, lon: 121.0266, format: 'mall', status: 'open', monthlySalesPhp: 408240 } });
  });
  it('skips rows it cannot place, outside the Philippines, or not open yet', () => {
    expect(outletRowFrom({ name: 'X' })).toEqual({ skip: 'X: no coordinates' });
    expect(outletRowFrom({ name: 'Y', lat: '1.3', lon: '103.8' })).toEqual({ skip: 'Y: coordinates outside the Philippines' });
    expect(outletRowFrom({ name: 'Z', lat: '14.6', lon: '121', status: 'Coming soon' })).toEqual({ skip: 'Z: not open yet (planned)' });
    expect(outletRowFrom({ lat: '14.6', lon: '121' })).toEqual({ skip: 'no name' });
  });
});

describe('Map legend for outlets (T-6)', () => {
  it('separates outlets typed into the intake from the brand network on file', () => {
    const typed = Array.from({ length: 5 }, () => ({ fromIntake: true }));
    const onFile = Array.from({ length: 6 }, () => ({ fromIntake: false }));
    expect(outletLegend([...typed, ...onFile])).toBe('Brand outlets (11): 5 you entered · 6 on file');
    expect(outletLegend(onFile)).toBe('Brand outlets on file (6)');
    expect(outletLegend(typed)).toBe('Your outlets (5)');
    expect(outletLegend([{}])).toBe('Your outlets (1)'); // legacy callers without the flag
  });
});

describe('Test / demo accounts left out of counts (T-7)', () => {
  it('flags the known test and demo patterns only', () => {
    for (const e of ['newuser-demo@local', 'owner@macaoimperial.test', 'analyst@grid.test', 'qa+1@grid.com.ph', 'demo@grid.com.ph', 'x@example.com'])
      expect(isTestAccountEmail(e)).toBe(true);
    for (const e of ['innovation@qosph.com', 'broker@grid.com.ph', 'contest@grid.com.ph', 'demonstrations@x.ph'])
      expect(isTestAccountEmail(e)).toBe(false);
    expect(isTestAccountEmail(null)).toBe(false);
  });
});
