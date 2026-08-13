import { describe, it, expect } from 'vitest';
import { scoreDaypart, scoreInformal, scoreMall, scoreHealthcare, rankWhiteSpace, type WhiteSpaceCell } from '@/lib/modules/p2p3Math';

describe('scoreDaypart', () => {
  it('matches a daytime format to a daytime-heavy catchment', () => {
    const r = scoreDaypart({ residentialPop: 20000, daytimePop: 80000, targetWindow: 'day' });
    expect(r.daytimeShare).toBeGreaterThan(70);
    expect(r.verdict).toBe('well_matched');
  });
  it('mismatches a daytime format to a residential catchment', () => {
    const r = scoreDaypart({ residentialPop: 90000, daytimePop: 10000, targetWindow: 'day' });
    expect(r.verdict).toBe('mismatched');
  });
  it('handles zero population without dividing by zero', () => {
    const r = scoreDaypart({ residentialPop: 0, daytimePop: 0, targetWindow: 'allday' });
    expect(r.daytimeShare).toBe(0);
  });
  // QA v5: the module persists a real 24h curve that VARIES by catchment (not flat,
  // not identical) — office-led peaks midday, residential peaks evening.
  it('persists a 24h curve whose peak shifts with the catchment', () => {
    const office = scoreDaypart({ residentialPop: 5000, daytimePop: 250000, targetWindow: 'day' });
    const resi = scoreDaypart({ residentialPop: 250000, daytimePop: 5000, targetWindow: 'day' });
    expect(office.hourly).toHaveLength(24);
    expect(resi.hourly).toHaveLength(24);
    expect(new Set(office.hourly).size).toBeGreaterThan(3); // not flat
    // Office-led peaks around midday; residential in the evening.
    expect(office.peakHour).toBeGreaterThanOrEqual(11);
    expect(office.peakHour).toBeLessThanOrEqual(14);
    expect(resi.peakHour).toBeGreaterThanOrEqual(17);
    expect(office.peakHour).not.toBe(resi.peakHour);
  });
});

describe('scoreInformal', () => {
  it('estimates informal competitors above the digital count', () => {
    const r = scoreInformal({ digitalCount: 4, informalMultiplier: 1.8 });
    expect(r.estimatedInformal).toBe(3); // round(4 * 0.8)
    expect(r.totalEstimated).toBe(7);
  });
  it('advises an on-ground check when informal is a large share', () => {
    expect(scoreInformal({ digitalCount: 2, informalMultiplier: 2.5 }).onGroundCheckAdvised).toBe(true);
    expect(scoreInformal({ digitalCount: 10, informalMultiplier: 1.2 }).onGroundCheckAdvised).toBe(false);
  });
});

describe('scoreMall', () => {
  it('rates a tier-A very-high-footfall mall as prime', () => {
    expect(scoreMall({ tier: 'A', footfallBand: 'very_high' }).verdict).toBe('prime');
  });
  it('rates a tier-C low-footfall mall as secondary', () => {
    expect(scoreMall({ tier: 'C', footfallBand: 'low' }).verdict).toBe('secondary');
  });
});

describe('scoreHealthcare', () => {
  it('returns no_data when no facility is near', () => {
    expect(scoreHealthcare({ nearestFacilityM: null, facilityCountWithin2km: 0 }).verdict).toBe('no_data');
  });
  it('scores a close, dense location as strong', () => {
    const r = scoreHealthcare({ nearestFacilityM: 200, facilityCountWithin2km: 4 });
    expect(r.verdict).toBe('strong');
  });
  it('scores a far location as weak', () => {
    expect(scoreHealthcare({ nearestFacilityM: 2800, facilityCountWithin2km: 0 }).verdict).toBe('weak');
  });
});

describe('rankWhiteSpace', () => {
  const cells: WhiteSpaceCell[] = [
    { psgcCode: 'a', barangay: 'A', population: 50000, nearestOwnM: 4000, competitorCount: 0 },  // high opportunity
    { psgcCode: 'b', barangay: 'B', population: 10000, nearestOwnM: 300, competitorCount: 0 },   // already served → excluded
    { psgcCode: 'c', barangay: 'C', population: 30000, nearestOwnM: 2000, competitorCount: 5 },  // mid, penalized
  ];
  it('excludes cells already served by an own outlet', () => {
    const gaps = rankWhiteSpace(cells);
    expect(gaps.find((g) => g.psgcCode === 'b')).toBeUndefined();
  });
  it('ranks the high-population unserved cell first', () => {
    const gaps = rankWhiteSpace(cells);
    expect(gaps[0].psgcCode).toBe('a');
  });
  it('explains why each gap qualifies', () => {
    const gaps = rankWhiteSpace(cells);
    expect(gaps[0].reason).toContain('pop');
  });
});
