/**
 * Overpass element → CaptureCandidate. Pure + unit-tested.
 *
 * Rules (Truth Layer + no fabrication):
 *  - the natural key is (type, id) — kept exactly as OSM gives it;
 *  - the category comes from the tag that MATCHED one of the requested selectors (captureCategory);
 *  - named places only, except transport stops, which get a generic label ("Jeepney/bus stop");
 *    grid-navigator's habit of naming an unnamed place after its category ("Health") is NOT copied;
 *  - OSM coordinates are Verified (same as the CLI sweep);
 *  - circle captures keep only points inside the circle (the Overpass query uses its bbox).
 */
import { captureCategory, transportLabel } from '@/lib/places/osmCategory';
import { cleanText, MAX_NAME_LEN, type CaptureCandidate, type OsmType } from './candidate';
import { containsPoint, type CaptureArea } from './area';

export interface OsmElementLike {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Parsed selector: key and value from '"k"="v"'. */
export interface TagMatcher { key: string; value: string; keepUnnamed: boolean }

export function parseSelector(sel: string, keepUnnamed = false): TagMatcher | null {
  const m = /^"([a-z_:]+)"="([a-z0-9_ ]+)"$/i.exec(sel.trim());
  return m ? { key: m[1], value: m[2], keepUnnamed } : null;
}

export type SkipReason = 'no_coords' | 'no_match' | 'unnamed' | 'outside_area';

export function mapElement(
  el: OsmElementLike,
  matchers: TagMatcher[],
  area?: CaptureArea,
): CaptureCandidate | SkipReason {
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return 'no_coords';
  if (area && !containsPoint(area, lat, lon)) return 'outside_area';
  const tags = el.tags ?? {};
  const hit = matchers.find((m) => tags[m.key] === m.value);
  if (!hit) return 'no_match';
  const kind = `${hit.key}=${hit.value}`;
  const category = captureCategory(kind);
  let name = cleanText(tags.name ?? tags['name:en'] ?? '', MAX_NAME_LEN);
  if (!name) {
    if (!hit.keepUnnamed && category !== 'transport') return 'unnamed';
    name = transportLabel(kind);
  }
  return {
    osmType: el.type as OsmType,
    osmId: el.id,
    name,
    kind,
    category,
    lat: round7(lat),
    lon: round7(lon),
    source: 'osm',
    truthLayer: 'verified',
  };
}

function round7(n: number): number {
  return Math.round(n * 1e7) / 1e7;
}
