import { describe, it, expect } from 'vitest';
import {
  quantile,
  distribution,
  percentileRank,
  flagVsMedian,
  benchmarkLease,
  MIN_SAMPLE,
  type Comp,
} from '@/lib/modules/leaseMath';

describe('quantile', () => {
  it('returns the single value for one element', () => {
    expect(quantile([42], 0.5)).toBe(42);
  });
  it('computes the median of an odd set', () => {
    expect(quantile([1, 2, 3], 0.5)).toBe(2);
  });
  it('interpolates the median of an even set', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });
  it('handles unsorted input', () => {
    expect(quantile([4, 1, 3, 2], 0.5)).toBe(2.5);
  });
});

describe('distribution', () => {
  it('is null when there are no numeric values', () => {
    expect(distribution([null, undefined])).toBeNull();
  });
  it('reports n, min, median, max', () => {
    const d = distribution([10, 20, 30, 40, 50])!;
    expect(d.n).toBe(5);
    expect(d.min).toBe(10);
    expect(d.median).toBe(30);
    expect(d.max).toBe(50);
  });
  it('ignores null/undefined but counts the rest', () => {
    const d = distribution([10, null, 30, undefined, 50])!;
    expect(d.n).toBe(3);
    expect(d.median).toBe(30);
  });
});

describe('percentileRank', () => {
  const comps = [1200, 1280, 1320, 1350, 1380, 1400, 1420, 1500, 1550];
  it('puts a below-min value near 0', () => {
    expect(percentileRank(comps, 1000)).toBeLessThan(5);
  });
  it('puts an above-max value near 100', () => {
    expect(percentileRank(comps, 2000)).toBeGreaterThan(95);
  });
  it('puts a mid value in the middle', () => {
    const p = percentileRank(comps, 1380);
    expect(p).toBeGreaterThan(40);
    expect(p).toBeLessThan(70);
  });
});

describe('flagVsMedian', () => {
  const stats = distribution([1200, 1280, 1320, 1350, 1380, 1400, 1420, 1500, 1550]); // median 1380
  it('flags a clearly-high rent as over market (higher is worse)', () => {
    expect(flagVsMedian(1550, stats)).toBe('over');
  });
  it('flags a clearly-low rent as under market', () => {
    expect(flagVsMedian(1200, stats)).toBe('under');
  });
  it('flags near-median as at market', () => {
    expect(flagVsMedian(1385, stats)).toBe('at');
  });
  it('returns insufficient when the sample is thin', () => {
    const thin = distribution([1300, 1400]); // n < MIN_SAMPLE
    expect(flagVsMedian(1500, thin)).toBe('insufficient');
  });
  it('inverts direction when higherIsWorse is false (fit-out)', () => {
    // A longer fit-out period is a concession → above median reads as "under" (better for tenant).
    expect(flagVsMedian(4, distribution([1, 2, 2, 2, 3]), { higherIsWorse: false })).toBe('under');
  });
});

describe('benchmarkLease (integration of the math)', () => {
  const comps: Comp[] = [
    { baseRentPhpSqm: 1200, escalationPct: 5, cusaPhpSqm: 160, leaseTermYears: 5, fitoutMonths: 2 },
    { baseRentPhpSqm: 1280, escalationPct: 5, cusaPhpSqm: 170, leaseTermYears: 7, fitoutMonths: 2 },
    { baseRentPhpSqm: 1320, escalationPct: 6, cusaPhpSqm: 175, leaseTermYears: 6, fitoutMonths: 3 },
    { baseRentPhpSqm: 1350, escalationPct: 5, cusaPhpSqm: 180, leaseTermYears: 7, fitoutMonths: 2 },
    { baseRentPhpSqm: 1380, escalationPct: 6, cusaPhpSqm: 185, leaseTermYears: 10, fitoutMonths: 3 },
    { baseRentPhpSqm: 1400, escalationPct: 5, cusaPhpSqm: 190, leaseTermYears: 7, fitoutMonths: 2 },
  ];

  it('finds a slightly-above-median rent as above market with positive negotiating room', () => {
    const out = benchmarkLease({ baseRentPhpSqm: 1450 }, comps);
    expect(out.verdict).toBe('above_market');
    expect(out.negotiatingRoomPhpSqm).toBeGreaterThan(0);
    expect(out.sampleSize).toBe(6);
    expect(out.lowSample).toBe(false);
  });

  it('finds a below-median rent as favourable', () => {
    const out = benchmarkLease({ baseRentPhpSqm: 1250 }, comps);
    expect(out.verdict).toBe('below_market');
    expect(out.negotiatingRoomPhpSqm).toBeLessThan(0);
  });

  it('returns insufficient_data when comps are too few', () => {
    const out = benchmarkLease({ baseRentPhpSqm: 1450 }, comps.slice(0, 2));
    expect(out.verdict).toBe('insufficient_data');
    expect(out.lowSample).toBe(true);
    expect(out.flags).toContain('low_sample');
  });

  it('never fabricates a percentile without an asking value, but still gives a corridor read', () => {
    const out = benchmarkLease({ escalationPct: 5 }, comps);
    // No asking base rent → no percentile is invented …
    expect(out.baseRentPercentile).toBeNull();
    // … but with a real comp sample we surface the corridor benchmark (median/range),
    // which is a valid market read, rather than falsely reporting "insufficient".
    expect(out.verdict).toBe('corridor_benchmark');
    expect(out.baseRentStats?.median).toBeGreaterThan(0);
  });

  it('respects MIN_SAMPLE as the reliability floor', () => {
    expect(MIN_SAMPLE).toBeGreaterThanOrEqual(5);
  });
});
