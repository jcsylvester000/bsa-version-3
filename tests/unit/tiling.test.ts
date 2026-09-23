/**
 * R-03 — pure bbox tiling used by the adaptive Overpass sweep.
 */
import { describe, it, expect } from 'vitest';
import { subdivide, quadrants, bboxHeightDeg, bboxCentre, bboxKey, type BBox } from '@/lib/geo/tiling';

describe('subdivide', () => {
  it('tiles a box into ceil(size/tile) rows×cols that cover it exactly', () => {
    const box: BBox = [14.0, 120.0, 14.2, 120.3]; // 0.2 lat × 0.3 lon
    const tiles = subdivide(box, 0.1);
    expect(tiles).toHaveLength(2 * 3); // 2 rows, 3 cols
    // Union spans the whole box (first tile at SW corner, last at NE corner).
    expect(tiles[0][0]).toBeCloseTo(14.0);
    expect(tiles[0][1]).toBeCloseTo(120.0);
    expect(tiles[tiles.length - 1][2]).toBeCloseTo(14.2);
    expect(tiles[tiles.length - 1][3]).toBeCloseTo(120.3);
  });
  it('never returns zero tiles for a tiny box', () => {
    expect(subdivide([14.0, 120.0, 14.01, 120.01], 0.08)).toHaveLength(1);
  });
  it('tiles are contiguous (no gaps in latitude within a column)', () => {
    const tiles = subdivide([14.0, 120.0, 14.2, 120.1], 0.1); // 2 rows, 1 col
    expect(tiles[0][2]).toBeCloseTo(tiles[1][0]); // row0 north == row1 south
  });
});

describe('quadrants', () => {
  it('splits a box into four equal parts meeting at the centre', () => {
    const q = quadrants([0, 0, 2, 2]);
    expect(q).toHaveLength(4);
    expect(q).toContainEqual([0, 0, 1, 1]);
    expect(q).toContainEqual([1, 1, 2, 2]);
    // The four areas sum to the parent's area.
    const area = (b: BBox) => (b[2] - b[0]) * (b[3] - b[1]);
    expect(q.reduce((s, b) => s + area(b), 0)).toBeCloseTo(4);
  });
});

describe('helpers', () => {
  it('bboxHeightDeg / bboxCentre', () => {
    expect(bboxHeightDeg([14.0, 120.0, 14.08, 120.1])).toBeCloseTo(0.08);
    expect(bboxCentre([14.0, 120.0, 14.2, 120.4])).toEqual({ lat: 14.1, lon: 120.2 });
  });
  it('bboxKey is stable and rounded', () => {
    expect(bboxKey([14.123456, 120.987654, 14.2, 121.0])).toBe('14.123:120.988:14.200:121.000');
  });
});
