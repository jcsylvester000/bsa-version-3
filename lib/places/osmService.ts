/**
 * OpenStreetMap / Overpass service — Google-free real-establishment sourcing.
 *
 * This is the drop-in replacement for placesService.ts when Google Places is disabled
 * (the project's DB-only mode). It queries the public Overpass API — no key, no billing —
 * to pull real POIs across an area (for competitor density) and to find a named brand's
 * branches across NCR (for saturation / white-space). Coordinates are Verified (OSM
 * surveyed geometry); anything derived (barangay by snap) is Assumed downstream.
 *
 * Overpass is a shared free resource — we are a polite client: a small concurrency of 1,
 * a delay between calls, a generous per-query timeout, and a retry with backoff on the
 * 429/504 the public instances return under load. This is INGEST-time code (db:populate),
 * not per-request runtime code, so latency is acceptable.
 *
 * Output shape matches placesService.RealPlace so downstream ingest/normalize is identical.
 */
import 'server-only';

/** Same shape placesService returns, so loaders/normalizers don't care about the source. */
export interface OsmPlace {
  osmId: number | null;
  name: string;
  lat: number;
  lon: number;
  /** OSM tag we matched on (amenity/shop value), for category mapping. */
  osmTag: string | null;
  /** OSM `brand`/`operator` tag when present — helps confirm a chain branch. */
  brand: string | null;
}

// Public Overpass endpoints. We rotate on failure — different instances have different load.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const QUERY_TIMEOUT_S = 90; // Overpass server-side timeout
const FETCH_TIMEOUT_MS = 120_000; // client abort a bit above the server timeout
const POLITE_DELAY_MS = 1500; // between successive calls — be a good citizen
const MAX_RETRIES = 5; // more attempts across the endpoint pool for public-instance 504s

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Vertical → OSM tag selectors. Each entry is a list of Overpass tag filters (the part
 * inside the [] of a query). We match nodes AND ways (a mall unit is often a way). The
 * selectors are deliberately broad on tag but the caller narrows by name for brand pulls.
 */
const OSM_SELECTORS: Record<string, string[]> = {
  fnb_qsr: ['"amenity"="fast_food"', '"amenity"="restaurant"'],
  fnb_cafe: ['"amenity"="cafe"', '"shop"="coffee"', '"cuisine"="bubble_tea"'],
  fnb_bakery: ['"shop"="bakery"', '"shop"="pastry"'],
  retail_apparel: ['"shop"="clothes"', '"shop"="fashion"'],
  retail_specialty: ['"shop"="variety_store"', '"shop"="water"', '"shop"="general"'],
  convenience: ['"shop"="convenience"'],
  remittance: ['"amenity"="bank"', '"shop"="money_lender"', '"office"="financial"', '"amenity"="money_transfer"'],
  pharmacy: ['"amenity"="pharmacy"', '"shop"="chemist"'],
  diagnostics: ['"healthcare"="laboratory"', '"amenity"="clinic"'],
  services_salon: ['"shop"="hairdresser"', '"shop"="beauty"'],
  services_spa: ['"leisure"="spa"', '"shop"="massage"', '"amenity"="spa"'],
  services_fitness: ['"leisure"="fitness_centre"', '"leisure"="sports_centre"'],
  services_laundry: ['"shop"="laundry"', '"shop"="dry_cleaning"'],
  fuel: ['"amenity"="fuel"'],
  automotive: ['"shop"="car_repair"', '"amenity"="car_wash"'],
  hotel: ['"tourism"="hotel"', '"tourism"="motel"'],
  education: ['"amenity"="school"', '"office"="educational_institution"', '"amenity"="prep_school"'],
  other: ['"shop"'],
};

/** Map an OSM tag value to the app's PoiCategory. Competitors are the default for the
 *  business-establishment tags; anchors/transport/schools/health get their own bucket. */
export function osmTagToPoiCategory(osmTag: string | null): string {
  const t = (osmTag ?? '').toLowerCase();
  if (/(school|educational_institution|prep_school)/.test(t)) return 'school';
  if (/(hospital)/.test(t)) return 'hospital';
  if (/(clinic|doctors)/.test(t)) return 'clinic';
  if (/(laboratory)/.test(t)) return 'diagnostic';
  if (/(mall|department_store)/.test(t)) return 'mall';
  if (/(bus_station|subway|station|public_transport|halt)/.test(t)) return 'transport';
  if (/(office)/.test(t)) return 'office';
  // Everything else that's a shop/amenity business = a competitor establishment.
  return 'competitor';
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** POST a raw Overpass QL query, rotating endpoints and retrying with backoff. */
/**
 * POST a raw Overpass QL query.
 *
 * Two modes:
 *  - PATIENT (default, `fast:false`): many attempts, long timeout, exponential backoff.
 *    For the bulk pre-warm ingest, where completeness matters and latency doesn't.
 *  - FAST (`fast:true`): few attempts, short timeout, minimal backoff. For the INTERACTIVE
 *    report warm, which must return quickly — a slow OSM just means "serve from the DB".
 */
async function runOverpass(ql: string, fast = false): Promise<OverpassElement[]> {
  const maxRetries = fast ? 2 : MAX_RETRIES;
  const fetchTimeout = fast ? 4000 : FETCH_TIMEOUT_MS;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchTimeout);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'GridBSA/1.0 (site-analysis; contact ops@grid.local)' },
        body: 'data=' + encodeURIComponent(ql),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.status === 429 || res.status === 504 || res.status === 503) {
        lastErr = new Error(`Overpass ${res.status} on ${endpoint}`);
        // Patient: exponential backoff. Fast: brief pause, then bail to the next (last) attempt.
        await sleep(fast ? 300 : Math.min(30_000, 3000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status} on ${endpoint}`);
        await sleep(fast ? 300 : 2000 * (attempt + 1));
        continue;
      }
      const data = (await res.json()) as { elements?: OverpassElement[] };
      return data.elements ?? [];
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      await sleep(fast ? 200 : 1500 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error('Overpass failed');
}

/** Turn Overpass elements into OsmPlace, keeping only named, coordinate-bearing rows. */
function toPlaces(elements: OverpassElement[], matchedTag: string | null): OsmPlace[] {
  const out: OsmPlace[] = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const name = el.tags?.name?.trim();
    if (lat == null || lon == null || !name) continue;
    // Prefer the specific matched tag; otherwise derive one from the element's own tags.
    const tag = matchedTag ?? deriveTag(el.tags);
    out.push({
      osmId: el.id,
      name,
      lat,
      lon,
      osmTag: tag,
      brand: el.tags?.brand?.trim() || el.tags?.operator?.trim() || null,
    });
  }
  return out;
}

function deriveTag(tags?: Record<string, string>): string | null {
  if (!tags) return null;
  for (const k of ['amenity', 'shop', 'leisure', 'tourism', 'office', 'healthcare']) {
    if (tags[k]) return `${k}=${tags[k]}`;
  }
  return null;
}

/**
 * All establishments of a vertical inside a bounding box. Used for the NCR competitor
 * sweep. `bbox` = [south, west, north, east]. Returns Verified-coordinate places.
 */
export async function establishmentsInBbox(
  vertical: string,
  bbox: [number, number, number, number],
  opts: { max?: number; fast?: boolean } = {},
): Promise<OsmPlace[]> {
  const selectors = OSM_SELECTORS[vertical] ?? OSM_SELECTORS.other;
  const [s, w, n, e] = bbox;
  // Build one query with all selectors for node+way, using the bbox as global bounds.
  const parts = selectors
    .map((sel) => `  node[${sel}](${s},${w},${n},${e});\n  way[${sel}](${s},${w},${n},${e});`)
    .join('\n');
  const serverTimeout = opts.fast ? 25 : QUERY_TIMEOUT_S;
  const ql = `[out:json][timeout:${serverTimeout}];\n(\n${parts}\n);\nout center ${opts.max ?? 400};`;
  const elements = await runOverpass(ql, opts.fast);
  if (!opts.fast) await sleep(POLITE_DELAY_MS); // no inter-call delay on the interactive path
  return toPlaces(elements, null);
}

/**
 * A named brand's branches across a bounding box (NCR). Matches the brand on OSM's
 * name/brand/operator tags case-insensitively. Used to map where a chain already
 * operates → saturation and white-space. `bbox` = [south, west, north, east].
 */
export async function brandBranchesInBbox(
  brandName: string,
  bbox: [number, number, number, number],
  opts: { max?: number } = {},
): Promise<OsmPlace[]> {
  const [s, w, n, e] = bbox;
  // Escape regex-significant chars in the brand for the Overpass ~ (regex) match.
  const safe = brandName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match name OR brand OR operator, case-insensitive (,i), across node+way.
  const keys = ['name', 'brand', 'operator'];
  const parts = keys
    .map((k) => `  node["${k}"~"${safe}",i](${s},${w},${n},${e});\n  way["${k}"~"${safe}",i](${s},${w},${n},${e});`)
    .join('\n');
  const ql = `[out:json][timeout:${QUERY_TIMEOUT_S}];\n(\n${parts}\n);\nout center ${opts.max ?? 200};`;
  const elements = await runOverpass(ql);
  await sleep(POLITE_DELAY_MS);
  return toPlaces(elements, null);
}

/** Nearby establishments of a vertical around a point (radius metres). Builds a bbox
 *  from the radius and delegates — Overpass has no cost penalty for a small bbox. */
export async function establishmentsNear(
  vertical: string,
  lat: number,
  lon: number,
  radiusM: number,
  opts: { max?: number; fast?: boolean } = {},
): Promise<OsmPlace[]> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const bbox: [number, number, number, number] = [lat - dLat, lon - dLon, lat + dLat, lon + dLon];
  return establishmentsInBbox(vertical, bbox, opts);
}

/** NCR bounding box (generous — covers all 17 LGUs). [south, west, north, east]. */
export const NCR_BBOX: [number, number, number, number] = [14.35, 120.90, 14.78, 121.15];
