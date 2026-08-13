/**
 * Google Places service — pulls REAL Philippine establishments near a point, so the
 * app processes real-world data (competitors, outlets) through Territory Guard and
 * the scoring math. The GOOGLE_API_KEY stays server-side.
 *
 * Cost control: results are cached in-process keyed by (lat,lon rounded, type,
 * radius) with a TTL, so repeated demo runs over the same area don't re-bill Google.
 * (A durable cache — a `places_cache` table or the existing `poi` table — is the
 * production upgrade; the interface here doesn't change.)
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { placeQueryForVertical } from './placeTypes';
import { conceptFor, filterRelevantCompetitors } from './competitorRelevance';

export interface RealPlace {
  name: string;
  lat: number;
  lon: number;
  address: string | null;
  primaryType: string | null;
}

interface CacheEntry {
  at: number;
  places: RealPlace[];
}

// Module-level cache (per server instance). Keyed by area+type.
const CACHE = new Map<string, CacheEntry>();
const TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function cacheKey(lat: number, lon: number, tag: string, radiusM: number): string {
  // Round to ~100 m so nearby requests share a cache bucket.
  return `${lat.toFixed(3)}:${lon.toFixed(3)}:${tag}:${radiusM}`;
}

/**
 * Master switch for LIVE Google Places/Geocoding calls.
 *
 * Live calls cost money, so they are OFF by default. To run the one-time data
 * ingest (db:populate) that pulls real POIs, set PLACES_LIVE=1 in the environment
 * for that command only. In normal app operation this stays unset, so every runtime
 * module reads from the database instead of calling Google — no per-request billing.
 *
 * A key must ALSO be present; PLACES_LIVE alone does nothing without GOOGLE_API_KEY.
 */
export function placesLiveEnabled(): boolean {
  const v = (process.env.PLACES_LIVE ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

export function hasPlacesKey(): boolean {
  return !!process.env.GOOGLE_API_KEY && placesLiveEnabled();
}

/** Nearby real establishments of a vertical's category, around a point. Cached. */
export async function nearbyForVertical(
  lat: number,
  lon: number,
  vertical: string,
  opts: { radiusM?: number; max?: number } = {},
): Promise<RealPlace[]> {
  const q = placeQueryForVertical(vertical);
  return nearby(lat, lon, q.includedTypes, `v:${vertical}`, opts);
}

/**
 * GENUINE competitors of a concept near a point — the concept-aware pull.
 *
 * For F&B concepts with a name discriminator (milk-tea, coffee) a nearby search by
 * type alone both misses real competitors (milk-tea shops typed generically) and
 * pulls false ones (coffee roasters for a milk-tea concept). So: for concepts whose
 * relevance depends on name, we TEXT-SEARCH the concept keyword (finds them), then
 * apply the relevance filter (confirms them). For unambiguous concepts (pharmacy,
 * fuel…) a type nearby-search is enough. Either way the result is filtered so only
 * same-concept competitors are returned. Cached like the underlying calls.
 */
export async function relevantCompetitors(
  lat: number,
  lon: number,
  vertical: string,
  brandOrConcept: string | undefined,
  opts: { radiusM?: number; max?: number } = {},
): Promise<RealPlace[]> {
  const concept = conceptFor(vertical, brandOrConcept);
  const max = opts.max ?? 20;
  const radiusM = opts.radiusM ?? 1500;

  // Live Places disabled → pull competitors from the DB (already-ingested POIs) and
  // run them through the SAME concept filter. Keeps Territory Guard working at zero
  // API cost using whatever the last ingest loaded.
  if (!hasPlacesKey()) {
    const raw = await competitorsFromDb(lat, lon, radiusM, Math.min(60, max * 3));
    return filterRelevantCompetitors(raw, concept).slice(0, max);
  }

  // Name-discriminated concepts: text search finds them; then filter.
  const nameDiscriminated = concept.allowName.length > 0 || (concept.allowTypes?.length ?? 0) > 0;
  let raw: RealPlace[];
  if (nameDiscriminated) {
    raw = await textSearchNear(concept.keyword, lat, lon, radiusM, { max: Math.min(20, max * 2) });
    // Fall back to a type nearby-search if text search returned little.
    if (raw.length < 3) {
      const byType = await nearby(lat, lon, concept.includedTypes, `c:${concept.key}`, { radiusM, max });
      raw = dedupeByCoord([...raw, ...byType]);
    }
  } else {
    raw = await nearby(lat, lon, concept.includedTypes, `c:${concept.key}`, { radiusM, max: Math.min(20, max * 2) });
  }
  return filterRelevantCompetitors(raw, concept).slice(0, max);
}

function dedupeByCoord(places: RealPlace[]): RealPlace[] {
  const seen = new Set<string>();
  const out: RealPlace[] = [];
  for (const p of places) {
    const k = `${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/**
 * DB-only competitor pull (used when live Places is disabled). Reads competitor POIs
 * already ingested into the `poi` table within the radius, nearest first. The POI has
 * no fine-grained Google primaryType, so downstream concept filtering is name-based —
 * which is what drives most F&B discrimination anyway (e.g. milk-tea by name).
 */
async function competitorsFromDb(lat: number, lon: number, radiusM: number, max: number): Promise<RealPlace[]> {
  const rows = await prisma.$queryRaw<Array<{ name: string; lat: number; lon: number; city: string | null }>>`
    SELECT name, lat, lon, city
    FROM poi
    WHERE category = 'competitor'
      AND geom IS NOT NULL
      AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${radiusM})
    ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) ASC
    LIMIT ${max}`;
  return rows.map((r) => ({ name: r.name, lat: r.lat, lon: r.lon, address: r.city, primaryType: null }));
}

/** Nearby real establishments by explicit Google place types. Cached. */
export async function nearby(
  lat: number,
  lon: number,
  includedTypes: string[],
  tag: string,
  opts: { radiusM?: number; max?: number } = {},
): Promise<RealPlace[]> {
  if (!hasPlacesKey()) return []; // live Places disabled → DB-only mode
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return [];
  const radiusM = opts.radiusM ?? 1200;
  const max = opts.max ?? 20;

  const ck = cacheKey(lat, lon, tag, radiusM);
  const hit = CACHE.get(ck);
  // Date.now is fine at runtime (not a workflow script).
  if (hit && Date.now() - hit.at < TTL_MS) return hit.places.slice(0, max);

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress,places.primaryType',
    },
    body: JSON.stringify({
      includedTypes,
      maxResultCount: Math.min(20, max),
      locationRestriction: { circle: { center: { latitude: lat, longitude: lon }, radius: radiusM } },
    }),
    cache: 'no-store',
  });
  if (!res.ok) return hit?.places ?? [];
  const data = (await res.json()) as {
    places?: Array<{
      displayName?: { text: string };
      location?: { latitude: number; longitude: number };
      formattedAddress?: string;
      primaryType?: string;
    }>;
  };
  const places: RealPlace[] = (data.places ?? [])
    .filter((p) => p.location)
    .map((p) => ({
      name: p.displayName?.text ?? 'Unnamed',
      lat: p.location!.latitude,
      lon: p.location!.longitude,
      address: p.formattedAddress ?? null,
      primaryType: p.primaryType ?? null,
    }));

  CACHE.set(ck, { at: Date.now(), places });
  return places.slice(0, max);
}

/** Text search — find a named brand's outlets across an area. Cached by query. */
export async function textSearch(query: string, opts: { max?: number } = {}): Promise<RealPlace[]> {
  if (!hasPlacesKey()) return []; // live Places disabled → DB-only mode
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return [];
  const max = opts.max ?? 20;
  const ck = `text:${query.toLowerCase()}`;
  const hit = CACHE.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.places.slice(0, max);

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress,places.primaryType',
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: Math.min(20, max), regionCode: 'PH' }),
    cache: 'no-store',
  });
  if (!res.ok) return hit?.places ?? [];
  const data = (await res.json()) as {
    places?: Array<{
      displayName?: { text: string };
      location?: { latitude: number; longitude: number };
      formattedAddress?: string;
      primaryType?: string;
    }>;
  };
  const places: RealPlace[] = (data.places ?? [])
    .filter((p) => p.location)
    .map((p) => ({
      name: p.displayName?.text ?? 'Unnamed',
      lat: p.location!.latitude,
      lon: p.location!.longitude,
      address: p.formattedAddress ?? null,
      primaryType: p.primaryType ?? null,
    }));
  CACHE.set(ck, { at: Date.now(), places });
  return places.slice(0, max);
}

/** Text search biased to a location — finds concept competitors near a point. Cached. */
export async function textSearchNear(
  query: string,
  lat: number,
  lon: number,
  radiusM: number,
  opts: { max?: number } = {},
): Promise<RealPlace[]> {
  if (!hasPlacesKey()) return []; // live Places disabled → DB-only mode
  const key = process.env.GOOGLE_API_KEY;
  if (!key || !query) return [];
  const max = opts.max ?? 20;
  const ck = `textnear:${query.toLowerCase()}:${lat.toFixed(3)}:${lon.toFixed(3)}:${radiusM}`;
  const hit = CACHE.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.places.slice(0, max);

  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask': 'places.displayName,places.location,places.formattedAddress,places.primaryType',
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: Math.min(20, max),
      regionCode: 'PH',
      locationBias: { circle: { center: { latitude: lat, longitude: lon }, radius: radiusM } },
    }),
    cache: 'no-store',
  });
  if (!res.ok) return hit?.places ?? [];
  const data = (await res.json()) as {
    places?: Array<{
      displayName?: { text: string };
      location?: { latitude: number; longitude: number };
      formattedAddress?: string;
      primaryType?: string;
    }>;
  };
  const places: RealPlace[] = (data.places ?? [])
    .filter((p) => p.location)
    .map((p) => ({
      name: p.displayName?.text ?? 'Unnamed',
      lat: p.location!.latitude,
      lon: p.location!.longitude,
      address: p.formattedAddress ?? null,
      primaryType: p.primaryType ?? null,
    }));
  CACHE.set(ck, { at: Date.now(), places });
  return places.slice(0, max);
}
