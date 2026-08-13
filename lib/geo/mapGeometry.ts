/**
 * Pure map-geometry helpers for the Territory Guard map — no browser or map-library
 * imports, so they are unit-testable. The client map component uses these to draw
 * catchment rings; keeping them here means the ring math is verified independently
 * of the (untestable) maplibre render layer.
 */

export interface GeoFeaturePolygon {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: [number, number][][] };
  properties: Record<string, never>;
}

/**
 * Build a GeoJSON circle polygon of `radiusM` metres around (lon, lat), as an
 * approximation with `points` segments. Uses a local equirectangular scaling
 * (fine at metropolitan scale). The ring is closed (first point repeated).
 */
export function geoCircle(lon: number, lat: number, radiusM: number, points = 64): GeoFeaturePolygon {
  const coords: [number, number][] = [];
  const distX = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const distY = radiusM / 110_540;
  for (let i = 0; i < points; i++) {
    const theta = (i / points) * (2 * Math.PI);
    coords.push([lon + distX * Math.cos(theta), lat + distY * Math.sin(theta)]);
  }
  coords.push(coords[0]);
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

/** Verdict → ring colour, shared by the map and any legend. */
export const VERDICT_COLOR: Record<string, string> = {
  adds: '#1F7A5A',
  mixed: '#B5852B',
  redistributes: '#B23A48',
};
