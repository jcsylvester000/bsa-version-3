/**
 * F-15: accessibility pillar scoring (pure). Distance to a transport node dominates density.
 */
import { describe, it, expect } from 'vitest';
import { scoreAccessibility, scoreSiteFit, type Pillar } from '@/lib/modules/siteFitMath';

describe('scoreAccessibility', () => {
  it('returns null when the transport layer is not loaded here (uncovered)', () => {
    expect(scoreAccessibility({ nearestTransportM: null, countWithinWalkM: 0, covered: false })).toBeNull();
  });
  it('null when nearest is missing even if flagged covered', () => {
    expect(scoreAccessibility({ nearestTransportM: null, countWithinWalkM: 3, covered: true })).toBeNull();
  });
  it('a stop at the door with several nearby scores high', () => {
    const s = scoreAccessibility({ nearestTransportM: 80, countWithinWalkM: 6, covered: true });
    expect(s).toBe(100); // dist 100 * .65 + density 100 * .35
  });
  it('a far, lone stop scores low', () => {
    const s = scoreAccessibility({ nearestTransportM: 850, countWithinWalkM: 1, covered: true })!;
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(20); // dist 0, density ~17 * .35
  });
  it('distance is weighted above density', () => {
    const closeSparse = scoreAccessibility({ nearestTransportM: 150, countWithinWalkM: 1, covered: true })!;
    const farDense = scoreAccessibility({ nearestTransportM: 800, countWithinWalkM: 6, covered: true })!;
    expect(closeSparse).toBeGreaterThan(farDense);
  });
  it('monotonic in distance', () => {
    const near = scoreAccessibility({ nearestTransportM: 200, countWithinWalkM: 3, covered: true })!;
    const mid = scoreAccessibility({ nearestTransportM: 500, countWithinWalkM: 3, covered: true })!;
    expect(near).toBeGreaterThan(mid);
  });
});

describe('accessibility feeds Site Fit without breaking the composite', () => {
  const base = (access: number | null): Pillar[] => [
    { key: 'demand', label: 'd', score: 70, weight: 0.5, truthLayer: 'verified' },
    { key: 'competition', label: 'c', score: 80, weight: 0.35, truthLayer: 'verified' },
    { key: 'accessibility', label: 'a', score: access, weight: 0.15, truthLayer: 'verified' },
  ];
  it('a null accessibility pillar is simply excluded (no crash, still scores)', () => {
    const r = scoreSiteFit(base(null));
    expect(r.composite).not.toBeNull();
    expect(r.flags.some((f) => f.startsWith('pillars_missing'))).toBe(true);
  });
  it('a scored accessibility pillar moves the composite', () => {
    const withAccess = scoreSiteFit(base(90)).composite!;
    const without = scoreSiteFit(base(null)).composite!;
    expect(withAccess).not.toBe(without);
  });
});
