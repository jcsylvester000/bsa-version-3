import { describe, it, expect } from 'vitest';
import { scoreCapacity } from '@/lib/modules/p2p3Math';
import { parseParcel, parseUnits } from '@/lib/modules/orchestrator';

// QA v6 — category-conditional intake fields feed real module reads.

describe('parseParcel (land verticals)', () => {
  it('reads an explicit sqm and frontage from a manual string', () => {
    const p = parseParcel('Corner lot 1,200 sqm with 25 m frontage');
    expect(p.lotAreaSqm).toBe(1200);
    expect(p.frontageM).toBe(25);
  });
  it('falls back to the band implied by a dropdown phrase', () => {
    const p = parseParcel('Inline lot 500–1,000 sqm, ≥ 20 m frontage');
    expect(p.lotAreaSqm).toBeGreaterThan(0);
    expect(p.frontageM).toBeGreaterThan(0);
  });
  it('returns nulls when nothing is supplied', () => {
    expect(parseParcel(null)).toEqual({ frontageM: null, lotAreaSqm: null });
    expect(parseParcel('')).toEqual({ frontageM: null, lotAreaSqm: null });
  });
});

describe('parseUnits (per-unit formats)', () => {
  it('takes the low end of a band', () => {
    expect(parseUnits('5–8 units')).toBe(5);
    expect(parseUnits('16+ units (large format)')).toBe(16);
  });
  it('reads a manual explicit count', () => {
    expect(parseUnits('3 chairs')).toBe(3);
  });
  it('returns null when absent', () => {
    expect(parseUnits(null)).toBeNull();
    expect(parseUnits('no number here')).toBeNull();
  });
});

describe('scoreCapacity (pop-per-unit + breakeven)', () => {
  it('flags below-breakeven when the catchment is too thin for the unit count', () => {
    // 16 machines needing 250 hh each = 4000 hh; a 5,000-pop catchment ≈ 1,220 hh → below.
    const r = scoreCapacity({ units: 16, catchmentPop: 5000, breakevenHouseholdsPerUnit: 250 });
    expect(r.clearsBreakeven).toBe(false);
    expect(r.verdict).toBe('below_breakeven');
    expect(r.flags).toContain('below_breakeven');
  });
  it('reads healthy when the catchment comfortably clears breakeven', () => {
    // 4 chairs × 300 hh = 1,200 hh needed; 80,000 pop ≈ 19,500 hh → healthy.
    const r = scoreCapacity({ units: 4, catchmentPop: 80000, breakevenHouseholdsPerUnit: 300 });
    expect(r.clearsBreakeven).toBe(true);
    expect(r.verdict).toBe('healthy');
    expect(r.popPerUnit).toBe(20000);
  });
  it('computes pop-per-unit and households', () => {
    const r = scoreCapacity({ units: 5, catchmentPop: 50000 });
    expect(r.popPerUnit).toBe(10000);
    expect(r.households).toBeGreaterThan(0);
  });
  it('returns unknown with honest flags when input is missing', () => {
    const r = scoreCapacity({ units: null, catchmentPop: 50000 });
    expect(r.verdict).toBe('unknown');
    expect(r.flags).toContain('no_unit_count');
  });
});
