import { describe, it, expect } from 'vitest';
import { geoCircle, VERDICT_COLOR } from '@/lib/geo/mapGeometry';

/** Haversine metres between two lon/lat points — to check ring radius. */
function metres(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

describe('geoCircle — catchment ring geometry (drives the Territory Guard map)', () => {
  const lon = 121.025;
  const lat = 14.548; // Makati

  it('produces a closed polygon ring', () => {
    const f = geoCircle(lon, lat, 900, 64);
    const ring = f.geometry.coordinates[0];
    expect(f.type).toBe('Feature');
    expect(f.geometry.type).toBe('Polygon');
    // 64 segments + a closing point.
    expect(ring).toHaveLength(65);
    // First and last point identical (closed).
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('ring points sit approximately the requested radius from the centre', () => {
    const radius = 900;
    const ring = geoCircle(lon, lat, radius, 64).geometry.coordinates[0];
    for (const [rlon, rlat] of ring) {
      const d = metres(lon, lat, rlon, rlat);
      // Equirectangular approximation → within ~5% at this scale.
      expect(d).toBeGreaterThan(radius * 0.95);
      expect(d).toBeLessThan(radius * 1.05);
    }
  });

  it('scales with radius (a 1500 m ring is wider than a 600 m ring)', () => {
    const small = geoCircle(lon, lat, 600, 32).geometry.coordinates[0][0];
    const big = geoCircle(lon, lat, 1500, 32).geometry.coordinates[0][0];
    expect(metres(lon, lat, big[0], big[1])).toBeGreaterThan(metres(lon, lat, small[0], small[1]));
  });

  it('honours the segment count', () => {
    expect(geoCircle(lon, lat, 500, 16).geometry.coordinates[0]).toHaveLength(17);
  });
});

describe('VERDICT_COLOR — the area recommendation colour', () => {
  it('maps each verdict to a distinct colour', () => {
    expect(VERDICT_COLOR.adds).toBeTruthy();
    expect(VERDICT_COLOR.mixed).toBeTruthy();
    expect(VERDICT_COLOR.redistributes).toBeTruthy();
    const colours = new Set([VERDICT_COLOR.adds, VERDICT_COLOR.mixed, VERDICT_COLOR.redistributes]);
    expect(colours.size).toBe(3);
  });
});
