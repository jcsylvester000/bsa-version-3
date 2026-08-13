import { describe, it, expect } from 'vitest';
import { cannibalizationFraction, verdictFromOverlap } from '@/lib/modules/territoryMath';
import { computeCompleteness } from '@/lib/modules/completeness';

describe('cannibalizationFraction', () => {
  it('is zero at zero overlap', () => {
    expect(cannibalizationFraction(0)).toBe(0);
  });
  it('is one at full overlap', () => {
    expect(cannibalizationFraction(100)).toBe(1);
  });
  it('is convex — small overlaps are discounted below linear', () => {
    // At 50% overlap the modelled fraction should be below 0.5 (convex response).
    expect(cannibalizationFraction(50)).toBeLessThan(0.5);
  });
  it('is monotonic', () => {
    expect(cannibalizationFraction(30)).toBeLessThan(cannibalizationFraction(60));
  });
  it('clamps out-of-range input', () => {
    expect(cannibalizationFraction(-10)).toBe(0);
    expect(cannibalizationFraction(150)).toBe(1);
  });
});

describe('verdictFromOverlap', () => {
  it('says adds for low overlap', () => {
    expect(verdictFromOverlap(5)).toBe('adds');
  });
  it('says mixed for moderate overlap', () => {
    expect(verdictFromOverlap(25)).toBe('mixed');
  });
  it('says redistributes for high overlap', () => {
    expect(verdictFromOverlap(60)).toBe('redistributes');
  });
});

describe('computeCompleteness', () => {
  it('is 0% for empty sections', () => {
    expect(computeCompleteness({}).pct).toBe(0);
  });

  it('lists the missing must-have sections', () => {
    const r = computeCompleteness({ a: 'x', b: 'y' });
    expect(r.present).toContain('a');
    expect(r.missing).toContain('k');
    expect(r.pct).toBeGreaterThan(0);
    expect(r.pct).toBeLessThan(100);
  });

  it('reaches 100% when every must-have section is present', () => {
    const all = { a: '1', b: '1', c: '1', d: '1', e: '1', f: '1', g: '1', k: '1' };
    expect(computeCompleteness(all).pct).toBe(100);
  });

  it('treats empty strings and empty arrays as not present', () => {
    const r = computeCompleteness({ a: '   ', b: [], c: 'ok' });
    expect(r.present).toContain('c');
    expect(r.present).not.toContain('a');
    expect(r.present).not.toContain('b');
  });
});
