import { describe, it, expect } from 'vitest';
import { haversineMeters, circleIntersectionArea, catchmentOverlap } from '@/lib/geo/geo';

describe('haversineMeters', () => {
  it('is zero for identical points', () => {
    expect(haversineMeters({ lat: 14.55, lon: 121.05 }, { lat: 14.55, lon: 121.05 })).toBe(0);
  });

  it('matches a known distance within tolerance', () => {
    // Makati Ayala (14.5547,121.0244) to BGC High Street (14.5507,121.0487) ≈ 2.7 km
    const d = haversineMeters({ lat: 14.5547, lon: 121.0244 }, { lat: 14.5507, lon: 121.0487 });
    expect(d).toBeGreaterThan(2500);
    expect(d).toBeLessThan(3000);
  });

  it('is symmetric', () => {
    const a = { lat: 14.6, lon: 121.0 };
    const b = { lat: 14.4, lon: 121.1 };
    expect(haversineMeters(a, b)).toBeCloseTo(haversineMeters(b, a), 6);
  });
});

describe('circleIntersectionArea', () => {
  it('is zero when circles do not touch', () => {
    expect(circleIntersectionArea(100, 100, 500)).toBe(0);
  });

  it('is the smaller circle area when fully contained', () => {
    // r1=200 contains r2=50 at d=10 → area = π * 50^2
    expect(circleIntersectionArea(200, 50, 10)).toBeCloseTo(Math.PI * 2500, 5);
  });

  it('equals full area for two identical concentric circles', () => {
    const r = 300;
    expect(circleIntersectionArea(r, r, 0)).toBeCloseTo(Math.PI * r * r, 5);
  });

  it('is between 0 and the smaller area for partial overlap', () => {
    const inter = circleIntersectionArea(300, 300, 300);
    expect(inter).toBeGreaterThan(0);
    expect(inter).toBeLessThan(Math.PI * 300 * 300);
  });
});

describe('catchmentOverlap', () => {
  it('reports 100% overlap for identical catchments at the same point', () => {
    const r = catchmentOverlap({ lat: 14.55, lon: 121.05 }, { lat: 14.55, lon: 121.05 }, 900, 900);
    expect(r.overlapPct).toBe(100);
    expect(r.distanceM).toBe(0);
  });

  it('reports 0% overlap for far-apart catchments', () => {
    const r = catchmentOverlap({ lat: 14.55, lon: 121.05 }, { lat: 14.42, lon: 121.03 }, 900, 900);
    expect(r.overlapPct).toBe(0);
  });

  it('reports partial overlap for nearby branches (the seed BGC case)', () => {
    // Candidate BGC High Street vs a nearby BGC branch (~350 m apart), both inline (900 m).
    const r = catchmentOverlap({ lat: 14.5556, lon: 121.0501 }, { lat: 14.5563, lon: 121.0533 }, 900, 900);
    expect(r.overlapPct).toBeGreaterThan(40);
    expect(r.overlapPct).toBeLessThan(100);
  });

  it('never exceeds 100%', () => {
    const r = catchmentOverlap({ lat: 14.55, lon: 121.05 }, { lat: 14.5501, lon: 121.0501 }, 500, 1200);
    expect(r.overlapPct).toBeLessThanOrEqual(100);
  });
});
