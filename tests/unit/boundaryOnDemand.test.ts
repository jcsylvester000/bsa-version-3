/** On-demand barangay boundaries: the PSGC index finds the right cities for a capture area. */
import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
import { citiesTouching, regionKeyFor, MAX_CITIES_PER_LOAD } from '@/lib/geo/boundaryOnDemand';
import index from '@/lib/geo/psgcIndex.json';

const box = (lat: number, lon: number, m: number): [number, number, number, number] => {
  const dLat = m / 111_320, dLon = m / (111_320 * Math.cos((lat * Math.PI) / 180));
  return [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
};

describe('boundaries on demand', () => {
  it('the index covers the whole country, HUCs included', () => {
    const m = (index as unknown as { municities: unknown[] }).municities;
    expect(m.length).toBeGreaterThan(1_600);
  });
  it('Baguio (an independent city outside any province file) is found first', () => {
    const c = citiesTouching(box(16.414565, 120.595492, 1500));
    expect(c[0].name).toBe('Baguio City');
    expect(c[0].provincePsgc).toBeNull();
    expect(c.length).toBeLessThanOrEqual(MAX_CITIES_PER_LOAD);
    expect(regionKeyFor(c[0])).toBe('ph-car');
  });
  it('Noveleta, Cavite maps to the registered cavite region', () => {
    const c = citiesTouching(box(14.4334, 120.8864, 700));
    expect(c[0].name).toBe('Noveleta');
    expect(regionKeyFor(c[0])).toBe('cavite');
  });
  it('a pin at sea returns nothing', () => {
    expect(citiesTouching(box(13.0, 119.0, 500))).toHaveLength(0);
  });
});
