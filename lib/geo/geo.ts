/**
 * Geo math for BSA — deterministic, testable, and the source of the "Verified"
 * measurements Territory Guard reports. No AI here: the model only phrases what
 * these functions compute.
 *
 * Catchments are modelled as circular trade areas of a given radius. Overlap % is
 * the area of the circle–circle intersection over the candidate's catchment area —
 * a measured value from coordinates, hence Truth Layer = Verified.
 */

const EARTH_RADIUS_M = 6_371_000;

export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = (d: number) => (d * Math.PI) / 180;

/** Great-circle (Haversine) distance in metres between two coordinates. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Area of intersection of two circles (radii r1, r2; centre distance d), in the
 * same squared units as the radii. Closed-form lens area.
 */
export function circleIntersectionArea(r1: number, r2: number, d: number): number {
  if (r1 <= 0 || r2 <= 0) return 0;
  // No overlap.
  if (d >= r1 + r2) return 0;
  // One circle fully inside the other → smaller circle's whole area.
  if (d <= Math.abs(r1 - r2)) {
    const rMin = Math.min(r1, r2);
    return Math.PI * rMin * rMin;
  }
  const r1s = r1 * r1;
  const r2s = r2 * r2;
  const alpha = Math.acos((d * d + r1s - r2s) / (2 * d * r1)) * 2;
  const beta = Math.acos((d * d + r2s - r1s) / (2 * d * r2)) * 2;
  const area =
    0.5 * r2s * (beta - Math.sin(beta)) +
    0.5 * r1s * (alpha - Math.sin(alpha));
  return area;
}

export interface OverlapResult {
  /** Distance between the two catchment centres, metres. */
  distanceM: number;
  /** Intersection area as a fraction (0–1) of the candidate's catchment area. */
  overlapFraction: number;
  /** Same, as a 0–100 percentage rounded to one decimal. */
  overlapPct: number;
}

/**
 * Overlap of a candidate site's catchment against one existing outlet's catchment.
 * `candidateRadiusM` is the candidate's trade-area radius; `outletRadiusM` the
 * outlet's. Overlap % is expressed relative to the CANDIDATE catchment, because the
 * question Territory Guard answers is "how much of the *new* branch's catchment is
 * already served by a sister branch."
 */
export function catchmentOverlap(
  candidate: LatLon,
  outlet: LatLon,
  candidateRadiusM: number,
  outletRadiusM: number,
): OverlapResult {
  const d = haversineMeters(candidate, outlet);
  const inter = circleIntersectionArea(candidateRadiusM, outletRadiusM, d);
  const candidateArea = Math.PI * candidateRadiusM * candidateRadiusM;
  const fraction = candidateArea > 0 ? Math.min(1, inter / candidateArea) : 0;
  return {
    distanceM: Math.round(d),
    overlapFraction: fraction,
    overlapPct: Math.round(fraction * 1000) / 10,
  };
}
