/**
 * Barangay boundaries ON DEMAND (2026-10-09) — load the PSA barangay polygons for the area being
 * captured, from inside the app, instead of running `db:fetch-boundaries` per province first.
 *
 *   capture area ─► lib/geo/psgcIndex.json (every city/municipality + its bbox, PSGC Q4-2023)
 *               ─► cities/municipalities touching the area (≤ 4, nearest first; already-loaded ones skipped)
 *               ─► their barangays (faeldon/philippines-json-maps, medium resolution, MIT)
 *               ─► admin_boundary (barangay rows, city row = union of its barangays, province name row)
 *               ─► PSGC tags for places already saved in the area that had none
 *
 * Same source and row mapping as prisma/fetchBoundaries.ts, so rows are identical whichever path
 * loaded them (upsert on psgc_code — idempotent). Truth Layer: admin_boundary rows are Verified (PSA).
 * Writes are plain multi-row statements (Neon HTTP adapter: no transactions). Server-only.
 */
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { regionForPoint } from '@/lib/geo/regions';
import { boundaryFeatureToRow } from '@/lib/geo/boundaryFeature';
import { bboxOfArea, type CaptureArea } from '@/lib/capture/area';
import index from '@/lib/geo/psgcIndex.json';

const BASE = 'https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson';
/** Most cities/municipalities one request loads (a 1–1.5 km ring touches 1–3; NCR corners up to 4). */
export const MAX_CITIES_PER_LOAD = 4;
const FETCH_TIMEOUT_MS = 9_000;
const ROWS_PER_STATEMENT = 40;

/** PSGC region code → the Philippine region code used in the region pickers. */
const PH_REGION_BY_PSGC: Record<string, string> = {
  '100000000': 'I', '200000000': 'II', '300000000': 'III', '400000000': 'IV-A', '500000000': 'V', '600000000': 'VI',
  '700000000': 'VII', '800000000': 'VIII', '900000000': 'IX', '1000000000': 'X', '1100000000': 'XI', '1200000000': 'XII',
  '1300000000': 'NCR', '1400000000': 'CAR', '1600000000': 'XIII', '1700000000': 'MIMAROPA', '1900000000': 'BARMM',
};

type Row = [number, string | null, number | null, number, number, number, number, number];
const MUNICITIES = (index as unknown as { municities: Row[] }).municities;
const PROVINCES = (index as unknown as { provinces: Array<[number, string | null, number, number, number, number, number]> }).provinces;

export interface CityRef { psgc: string; name: string; provincePsgc: string | null; regionPsgc: string; bbox: [number, number, number, number] }

/** Cities/municipalities whose bounding box touches the bbox, nearest centre first. Pure (unit-tested). */
export function citiesTouching(bbox: [number, number, number, number], limit = MAX_CITIES_PER_LOAD): CityRef[] {
  const [s, w, n, e] = bbox;
  const cLat = (s + n) / 2, cLon = (w + e) / 2;
  return MUNICITIES
    .filter((m) => !(m[6] < s || m[4] > n || m[7] < w || m[5] > e))
    .map((m) => {
      const inside = cLat >= m[4] && cLat <= m[6] && cLon >= m[5] && cLon <= m[7];
      const d = Math.hypot((m[4] + m[6]) / 2 - cLat, ((m[5] + m[7]) / 2 - cLon) * Math.cos((cLat * Math.PI) / 180));
      return { m, score: (inside ? 0 : 1) + d };
    })
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ m }) => ({ psgc: String(m[0]), name: m[1] ?? String(m[0]), provincePsgc: m[2] == null ? null : String(m[2]), regionPsgc: String(m[3]), bbox: [m[4], m[5], m[6], m[7]] }));
}

/** BSA region key for a city: the registered region when it covers the city, else `ph-<code>` (e.g. ph-car). */
export function regionKeyFor(city: CityRef): string {
  const lat = (city.bbox[0] + city.bbox[2]) / 2, lon = (city.bbox[1] + city.bbox[3]) / 2;
  return regionForPoint(lat, lon) ?? `ph-${(PH_REGION_BY_PSGC[city.regionPsgc] ?? city.regionPsgc).toLowerCase()}`;
}

async function getJson(url: string): Promise<{ features?: Array<{ properties?: Record<string, unknown>; geometry?: unknown }> } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'GridBSA/1.0 (boundaries on demand)' }, signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface BoundaryLoadResult {
  cities: Array<{ psgc: string; name: string; barangays: number; status: 'loaded' | 'already' | 'failed' }>;
  barangaysLoaded: number;
  placesTagged: number;
}

/**
 * Load barangay boundaries for every city/municipality the area touches (≤ 4), then tag places
 * already saved there. Idempotent; cities already loaded are skipped.
 */
export async function loadBoundariesForArea(area: CaptureArea): Promise<BoundaryLoadResult> {
  const [s, w, n, e] = bboxOfArea(area);
  const pad = 0.003; // ~300 m so a ring on a city line pulls both sides
  const cities = citiesTouching([s - pad, w - pad, n + pad, e + pad]);
  const result: BoundaryLoadResult = { cities: [], barangaysLoaded: 0, placesTagged: 0 };
  if (!cities.length) return result;

  const loaded = await prisma.$queryRaw<Array<{ parent: string; n: number }>>(Prisma.sql`
    SELECT parent_psgc AS parent, COUNT(*)::int AS n FROM admin_boundary
    WHERE level = 'barangay' AND geom IS NOT NULL AND parent_psgc IN (${Prisma.join(cities.map((c) => c.psgc))})
    GROUP BY parent_psgc`);
  const have = new Map(loaded.map((r) => [r.parent, r.n]));
  const provincesNeeded = new Set<string>();

  for (const city of cities) {
    if (have.get(city.psgc)) { result.cities.push({ psgc: city.psgc, name: city.name, barangays: have.get(city.psgc)!, status: 'already' }); continue; }
    const fc = await getJson(`${BASE}/municities/medres/bgysubmuns-municity-${city.psgc}.0.01.json`);
    const region = regionKeyFor(city);
    const rows = (fc?.features ?? [])
      .map((f) => ({ row: boundaryFeatureToRow(f.properties ?? {}, 'barangay'), geom: f.geometry }))
      .filter((x): x is { row: NonNullable<typeof x.row>; geom: unknown } => !!x.row && !!x.geom);
    if (!rows.length) { result.cities.push({ psgc: city.psgc, name: city.name, barangays: 0, status: 'failed' }); continue; }
    for (let i = 0; i < rows.length; i += ROWS_PER_STATEMENT) {
      const values = Prisma.join(rows.slice(i, i + ROWS_PER_STATEMENT).map(({ row, geom }) => Prisma.sql`(
        ${row.psgcCode}, 'barangay', ${row.name}, ${row.parentPsgc ?? city.psgc}, ${region},
        ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(geom)}), 4326)))::geography)`));
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO admin_boundary (psgc_code, level, name, parent_psgc, region, geom) VALUES ${values}
        ON CONFLICT (psgc_code) DO UPDATE SET level = EXCLUDED.level, name = EXCLUDED.name,
          parent_psgc = EXCLUDED.parent_psgc, region = EXCLUDED.region, geom = EXCLUDED.geom`);
    }
    // City row: name from the PSGC index, polygon = union of its own barangays (nothing invented).
    await prisma.$executeRaw`
      INSERT INTO admin_boundary (psgc_code, level, name, parent_psgc, region, geom)
      SELECT ${city.psgc}, 'city', ${city.name}, ${city.provincePsgc}, ${region},
             ST_Multi(ST_Union(b.geom::geometry))::geography
      FROM admin_boundary b WHERE b.level = 'barangay' AND b.parent_psgc = ${city.psgc} AND b.geom IS NOT NULL
      ON CONFLICT (psgc_code) DO UPDATE SET level = 'city', name = EXCLUDED.name, parent_psgc = COALESCE(EXCLUDED.parent_psgc, admin_boundary.parent_psgc),
        region = EXCLUDED.region, geom = EXCLUDED.geom`;
    if (city.provincePsgc) provincesNeeded.add(`${city.provincePsgc}|${city.regionPsgc}|${region}`);
    result.cities.push({ psgc: city.psgc, name: city.name, barangays: rows.length, status: 'loaded' });
    result.barangaysLoaded += rows.length;
  }

  // Province rows (name only — tagging reads barangay polygons) so tags read "Brgy X, City Y, Province Z".
  for (const key of provincesNeeded) {
    const [prov, reg, region] = key.split('|');
    const name = PROVINCES.find((p) => String(p[0]) === prov)?.[1];
    if (!name) continue;
    await prisma.$executeRaw`
      INSERT INTO admin_boundary (psgc_code, level, name, parent_psgc, region)
      VALUES (${prov}, 'province', ${name}, ${reg}, ${region})
      ON CONFLICT (psgc_code) DO NOTHING`;
  }

  // Tag places already saved in this area that have no barangay yet.
  if (result.barangaysLoaded) {
    result.placesTagged = await prisma.$executeRaw`
      UPDATE poi p SET psgc_code = sub.psgc, barangay = sub.bgy, city = sub.city, province = sub.prov, region = COALESCE(sub.region, p.region)
      FROM (
        SELECT p2.id AS pid, b.psgc_code AS psgc, b.name AS bgy, b.region AS region, c.name AS city, pr.name AS prov
        FROM poi p2
        JOIN LATERAL (
          SELECT ab.* FROM admin_boundary ab
          WHERE ab.level = 'barangay' AND ab.geom IS NOT NULL AND ST_Intersects(ab.geom, p2.geom) LIMIT 1
        ) b ON true
        LEFT JOIN admin_boundary c  ON c.psgc_code  = b.parent_psgc
        LEFT JOIN admin_boundary pr ON pr.psgc_code = c.parent_psgc
        WHERE p2.psgc_code IS NULL AND p2.geom IS NOT NULL
          AND p2.geom && ST_MakeEnvelope(${w - pad}, ${s - pad}, ${e + pad}, ${n + pad}, 4326)::geography
      ) sub
      WHERE p.id = sub.pid`;
  }
  return result;
}
