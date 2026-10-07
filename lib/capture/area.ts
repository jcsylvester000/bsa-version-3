/**
 * Capture areas (admin POI capture). Pure + client-safe: the map screen and the API validate the
 * SAME shapes. An area is a rectangle or a circle; both resolve to a bbox (for the Overpass query),
 * a point-in-area test (circle results are trimmed to the circle), an approximate area in km² (for
 * the per-request cap) and a closed GeoJSON polygon ring (stored on the batch for the coverage map).
 */
import { z } from 'zod';

/** Philippine bounds — the same sanity box the loaders use. */
export const PH_BOUNDS = { south: 4, west: 116, north: 21, east: 127 } as const;

/** Largest area one capture request may pull from public Overpass (km²). Bigger areas → CLI sweep. */
export const MAX_CAPTURE_KM2 = 25;

const lat = z.number().finite().min(PH_BOUNDS.south).max(PH_BOUNDS.north);
const lon = z.number().finite().min(PH_BOUNDS.west).max(PH_BOUNDS.east);

export const RectArea = z.object({ kind: z.literal('rect'), south: lat, west: lon, north: lat, east: lon })
  .refine((a) => a.north > a.south && a.east > a.west, { message: 'north/east must be greater than south/west' });
export const CircleArea = z.object({ kind: z.literal('circle'), lat, lon, radiusM: z.number().int().min(50).max(3_000) });
export const CaptureAreaSchema = z.union([RectArea, CircleArea]);
export type CaptureArea = z.infer<typeof CaptureAreaSchema>;

/** [south, west, north, east]. */
export type BBox = [number, number, number, number];

const M_PER_DEG_LAT = 111_320;
const mPerDegLon = (atLat: number) => M_PER_DEG_LAT * Math.cos((atLat * Math.PI) / 180);

export function bboxOfArea(a: CaptureArea): BBox {
  if (a.kind === 'rect') return [a.south, a.west, a.north, a.east];
  const dLat = a.radiusM / M_PER_DEG_LAT;
  const dLon = a.radiusM / mPerDegLon(a.lat);
  return [a.lat - dLat, a.lon - dLon, a.lat + dLat, a.lon + dLon];
}

/** Approximate area in km² (equirectangular — fine at capture scale). */
export function areaKm2(a: CaptureArea): number {
  if (a.kind === 'circle') return (Math.PI * a.radiusM * a.radiusM) / 1e6;
  const midLat = (a.north + a.south) / 2;
  const h = (a.north - a.south) * M_PER_DEG_LAT;
  const w = (a.east - a.west) * mPerDegLon(midLat);
  return (h * w) / 1e6;
}

/** Great-circle distance in metres (haversine). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function containsPoint(a: CaptureArea, pLat: number, pLon: number): boolean {
  if (a.kind === 'circle') return distanceM(a.lat, a.lon, pLat, pLon) <= a.radiusM;
  return pLat >= a.south && pLat <= a.north && pLon >= a.west && pLon <= a.east;
}

/** Closed polygon ring as [lon, lat] pairs (GeoJSON order). Circles use `segments` vertices. */
export function areaRing(a: CaptureArea, segments = 48): Array<[number, number]> {
  if (a.kind === 'rect') {
    return [[a.west, a.south], [a.east, a.south], [a.east, a.north], [a.west, a.north], [a.west, a.south]];
  }
  const ring: Array<[number, number]> = [];
  for (let i = 0; i < segments; i++) {
    const t = (2 * Math.PI * i) / segments;
    const dy = (a.radiusM * Math.sin(t)) / M_PER_DEG_LAT;
    const dx = (a.radiusM * Math.cos(t)) / mPerDegLon(a.lat);
    ring.push([round6(a.lon + dx), round6(a.lat + dy)]);
  }
  ring.push(ring[0]);
  return ring;
}

export function areaGeoJson(a: CaptureArea): { type: 'Polygon'; coordinates: Array<Array<[number, number]>> } {
  return { type: 'Polygon', coordinates: [areaRing(a)] };
}

/** Human label for an area ("2.4 km² rectangle", "800 m circle"). */
export function describeArea(a: CaptureArea): string {
  return a.kind === 'circle'
    ? `${a.radiusM.toLocaleString('en-US')} m radius circle`
    : `${areaKm2(a).toFixed(1)} km² rectangle`;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
