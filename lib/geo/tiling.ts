/**
 * Pure bbox tiling for the Overpass sweep (R-03). A single Overpass query is capped
 * (`out center N`), so a dense area truncates silently. We tile the region and, when a
 * tile still hits the cap, split it into quadrants and retry — so coverage is complete.
 * No I/O; unit-tested in tests/unit/tiling.test.ts.
 */

/** [south, west, north, east] in WGS84 degrees. */
export type BBox = [number, number, number, number];

/** Split a bbox into a grid of ~`tileDeg`-sized cells (ceil so the whole box is covered). */
export function subdivide(bbox: BBox, tileDeg: number): BBox[] {
  const [s, w, n, e] = bbox;
  const rows = Math.max(1, Math.ceil((n - s) / tileDeg));
  const cols = Math.max(1, Math.ceil((e - w) / tileDeg));
  const dLat = (n - s) / rows;
  const dLon = (e - w) / cols;
  const out: BBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ts = s + r * dLat;
      const tw = w + c * dLon;
      out.push([ts, tw, ts + dLat, tw + dLon]);
    }
  }
  return out;
}

/** Split one bbox into its four quadrants. */
export function quadrants(bbox: BBox): BBox[] {
  const [s, w, n, e] = bbox;
  const mLat = (s + n) / 2;
  const mLon = (w + e) / 2;
  return [
    [s, w, mLat, mLon],
    [s, mLon, mLat, e],
    [mLat, w, n, mLon],
    [mLat, mLon, n, e],
  ];
}

/** Height of a bbox in degrees latitude (used to decide whether it may still be split). */
export function bboxHeightDeg(bbox: BBox): number {
  return bbox[2] - bbox[0];
}

/** Centre of a bbox (lat, lon). */
export function bboxCentre(bbox: BBox): { lat: number; lon: number } {
  return { lat: (bbox[0] + bbox[2]) / 2, lon: (bbox[1] + bbox[3]) / 2 };
}

/** Stable checkpoint key for a tile (rounded so re-runs match). */
export function bboxKey(bbox: BBox): string {
  return bbox.map((v) => v.toFixed(3)).join(':');
}
