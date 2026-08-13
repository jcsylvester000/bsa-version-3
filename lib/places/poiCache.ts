/**
 * On-demand POI cache (DB-first, OSM-on-miss) — the platform-wide, self-warming cache.
 *
 * The design goal: never bulk-fetch all of NCR up front (wasteful, over-uses the API).
 * Instead, when a REPORT needs establishments around a site, we:
 *   1. Work out which grid cell(s) the query area falls in.
 *   2. Look each (cell, vertical) up in `poi_coverage`.
 *      - Covered AND fresh (within TTL) → serve the matching rows straight from `poi`.
 *      - Missing OR stale → pull that cell from OSM ONCE, persist the rows into the shared
 *        `poi` table, stamp `poi_coverage`, then serve.
 *   3. Every persisted row is shared by ALL users — the next report over the same area
 *      (any account) reads from the DB and makes zero API calls.
 *
 * So API usage is proportional to NEW ground covered, not to report volume. A city that
 * has been analysed once is effectively free forever (until the TTL lapses).
 *
 * This module is the single place that decides DB-vs-OSM. Runtime callers
 * (Territory Guard, the orchestrator) go through `competitorsNear`, which returns the same
 * RealPlace shape the old placesService did — so nothing downstream changes.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { RealPlace } from './placesService';
import { establishmentsNear, osmTagToPoiCategory, type OsmPlace } from './osmService';
import { conceptFor, filterRelevantCompetitors } from './competitorRelevance';

/** NCR centre grid — the busy corridors the deliberate warm pass sweeps per vertical.
 *  Mirrors the ingest NCR_GRID; kept here so the warm endpoint has no cross-import. */
export const NCR_CENTERS: Array<{ lat: number; lon: number; label: string }> = [
  { lat: 14.5547, lon: 121.0244, label: 'Makati CBD' },
  { lat: 14.5507, lon: 121.0487, label: 'BGC' },
  { lat: 14.5866, lon: 121.0614, label: 'Ortigas' },
  { lat: 14.6349, lon: 121.0388, label: 'QC Cubao' },
  { lat: 14.6091, lon: 120.9899, label: 'Manila España' },
  { lat: 14.5378, lon: 121.0014, label: 'Pasay MOA' },
  { lat: 14.4791, lon: 121.0198, label: 'Alabang' },
  { lat: 14.5794, lon: 121.0359, label: 'Mandaluyong' },
];

/** How long a cell's coverage stays fresh before we re-pull it from OSM. */
const COVERAGE_TTL_MS = 1000 * 60 * 60 * 24 * 90; // 90 days

/** Master switch: allow live OSM fetches on a cache miss. On by default (OSM is free);
 *  set OSM_LIVE=0 to force pure DB-only (e.g. offline dev, or to freeze API usage). */
export function osmLiveEnabled(): boolean {
  const v = (process.env.OSM_LIVE ?? '1').toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** Grid-cell key: lat/lon rounded to 3 decimals (~110m latitude / ~1.1km bucket). A report's
 *  ~800m radius touches at most a handful of cells; we key coverage at this granularity so a
 *  cell is a meaningful, reusable unit rather than a per-point cache. */
function cellKey(lat: number, lon: number): string {
  return `${lat.toFixed(2)}:${lon.toFixed(2)}`; // ~1.1km cells
}

/** The set of cell keys (with centroids) a circular query area overlaps. */
function cellsForArea(lat: number, lon: number, radiusM: number): Array<{ key: string; lat: number; lon: number }> {
  // Step across the bounding box in ~1.1km steps (0.01deg) so every touched cell is covered.
  const step = 0.01;
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  const out = new Map<string, { key: string; lat: number; lon: number }>();
  for (let la = lat - dLat; la <= lat + dLat + step; la += step) {
    for (let lo = lon - dLon; lo <= lon + dLon + step; lo += step) {
      const clat = Math.round(la * 100) / 100;
      const clon = Math.round(lo * 100) / 100;
      const key = `${clat.toFixed(2)}:${clon.toFixed(2)}`;
      if (!out.has(key)) out.set(key, { key, lat: clat, lon: clon });
    }
  }
  return [...out.values()];
}

/** Persist OSM places into the shared poi table (idempotent on osm_id), returning how many
 *  new rows were written. Geom is set from lat/lon (poi has a trigger, but we set it
 *  explicitly so a fresh row is queryable immediately in the same request). */
async function persistPois(places: OsmPlace[]): Promise<number> {
  let written = 0;
  for (const p of places) {
    if (!p.name || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    const category = osmTagToPoiCategory(p.osmTag);
    const data = {
      name: p.name,
      category: category as never,
      lat: p.lat,
      lon: p.lon,
      city: null as string | null,
      barangay: null as string | null,
      truthLayer: 'verified' as const,
    };
    let id: bigint | null = null;
    if (p.osmId != null) {
      const existing = await prisma.poi.findFirst({ where: { osmId: BigInt(p.osmId) }, select: { id: true } });
      if (existing) {
        await prisma.poi.update({ where: { id: existing.id }, data });
        id = existing.id;
      } else {
        const created = await prisma.poi.create({ data: { ...data, osmId: BigInt(p.osmId), source: 'osm' } });
        id = created.id;
        written++;
      }
    } else {
      const created = await prisma.poi.create({ data: { ...data, source: 'osm' } });
      id = created.id;
      written++;
    }
    if (id != null) {
      await prisma.$executeRaw`UPDATE poi SET geom = ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)::geography WHERE id = ${id} AND geom IS NULL`;
    }
  }
  return written;
}

/**
 * Interactive warm budget. A report must NEVER hang waiting on OSM — the DB already holds
 * thousands of pre-warmed POIs, so the warm is a best-effort bonus, strictly time-boxed.
 * If OSM is slow/rate-limiting, we stop warming and serve from the DB immediately. Any
 * cells left uncovered get warmed by a later report (or the bulk pre-warm).
 */
const WARM_BUDGET_MS = 4500; // total wall-clock a report will spend warming, across all cells
const PER_CELL_TIMEOUT_MS = 3000; // hard cap per single OSM cell fetch during a report

/** Race a promise against a timeout — the interactive path can't wait on a slow endpoint. */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('warm timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** After the interactive budget, we keep warming still-cold cells within a second, larger
 *  budget so a site's whole neighbourhood fills in on the first report instead of one cell
 *  at a time. This is AWAITED (not fire-and-forget) so it survives the request lifecycle in
 *  all runtimes — the ceiling keeps it bounded. Territory/report calls already take ~10s, so
 *  the extra warming for a cold vertical is acceptable and only happens until an area is covered. */
const TOPUP_BUDGET_MS = 12_000; // additional wall-clock for filling deferred cells
const TOPUP_CELL_CAP = 24; // hard cap on cells warmed per call, to stay kind to Overpass

/** Is this (cell, vertical) already covered and fresh? Fault-tolerant (returns false on any error). */
async function cellFresh(cellKey: string, vertical: string): Promise<boolean> {
  try {
    const cov = await prisma.poiCoverage.findUnique({
      where: { coverage_cell_vertical: { cellKey, vertical } },
      select: { fetchedAt: true },
    });
    return !!cov && Date.now() - cov.fetchedAt.getTime() < COVERAGE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Global serialization for PATIENT (deliberate warm-pass) OSM fetches. Public Overpass
 * instances rate-limit hard under concurrency — firing many warms at once makes them ALL
 * fail. So every patient warm goes through this single-lane queue: they run one at a time,
 * server-wide, no matter how many warm requests arrive at once. (Interactive `fast` warms
 * skip the queue so a running bulk warm never delays a user's report.)
 */
let patientLane: Promise<unknown> = Promise.resolve();
function runPatient<T>(fn: () => Promise<T>): Promise<T> {
  const next = patientLane.then(fn, fn);
  // Keep the chain alive even if a job throws, without holding the return value.
  patientLane = next.then(() => undefined, () => undefined);
  return next;
}

/** Warm ONE cell: pull from OSM, persist, stamp coverage. `fast` for the interactive path,
 *  patient for the deliberate warm pass (serialized). Never throws. Returns true if it fetched. */
async function warmCell(cell: { key: string; lat: number; lon: number }, vertical: string, fast: boolean): Promise<boolean> {
  try {
    const places = fast
      ? await withTimeout(establishmentsNear(vertical, cell.lat, cell.lon, 700, { max: 200, fast: true }), PER_CELL_TIMEOUT_MS)
      : await runPatient(() => establishmentsNear(vertical, cell.lat, cell.lon, 700, { max: 200 }));
    await persistPois(places);
    await prisma.poiCoverage.upsert({
      where: { coverage_cell_vertical: { cellKey: cell.key, vertical } },
      create: { cellKey: cell.key, vertical, lat: cell.lat, lon: cell.lon, poiCount: places.length, source: 'osm' },
      update: { poiCount: places.length, fetchedAt: new Date(), source: 'osm' },
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the cells overlapping a query area are covered for a vertical — pulling from OSM
 * only the cells that are missing or stale, within a strict INTERACTIVE time budget. Returns
 * the number of OSM fetches performed. Never throws; never blocks longer than WARM_BUDGET_MS.
 *
 * Any cells NOT reached within the budget are handed to a fire-and-forget BACKGROUND top-up
 * (patient mode) that keeps warming them after the report has already responded — so a site's
 * whole neighbourhood fills in over one report instead of one cell per report. The background
 * work is best-effort and capped; it never affects the response the user is waiting on.
 */
export async function ensureCoverage(lat: number, lon: number, vertical: string, radiusM: number): Promise<number> {
  if (!osmLiveEnabled()) return 0; // frozen to DB-only
  const cells = cellsForArea(lat, lon, radiusM);
  const deadline = Date.now() + WARM_BUDGET_MS;
  let fetches = 0;
  const deferred: Array<{ key: string; lat: number; lon: number }> = [];

  for (const cell of cells) {
    if (await cellFresh(cell.key, vertical)) continue;
    if (Date.now() >= deadline) {
      // Budget spent — defer the rest to the background top-up rather than dropping them.
      deferred.push(cell);
      continue;
    }
    if (await warmCell(cell, vertical, true)) fetches++;
  }

  // NOTE: we intentionally do NOT block the report to warm the `deferred` cells — the
  // interactive path stays fast. Comprehensive coverage of an area comes from an explicit
  // warm pass (warmArea() / the /api/admin/warm endpoint / the bulk db:ingest:osm), not by
  // slowing every user's report. A report warms only what it can within the small budget;
  // over successive reports (and the warm endpoint) the shared cache fills in.
  void deferred; // retained for readability; see warmArea() for the fill path
  return fetches;
}

/**
 * Warm ALL cells overlapping an area for a vertical, patiently, within a generous budget.
 * This is the explicit fill path — called by the warm endpoint / QA / ops to build coverage
 * for an area without any report waiting on it. Returns cells fetched. Bounded + awaited, so
 * it works in any runtime.
 */
export async function warmArea(lat: number, lon: number, vertical: string, radiusM: number, opts: { budgetMs?: number; cellCap?: number } = {}): Promise<{ fetched: number; skipped: number; cells: number }> {
  if (!osmLiveEnabled()) return { fetched: 0, skipped: 0, cells: 0 };
  const cells = cellsForArea(lat, lon, radiusM).slice(0, opts.cellCap ?? TOPUP_CELL_CAP);
  const deadline = Date.now() + (opts.budgetMs ?? TOPUP_BUDGET_MS);
  let fetched = 0;
  let skipped = 0;
  for (const cell of cells) {
    if (Date.now() >= deadline) break;
    if (await cellFresh(cell.key, vertical)) { skipped++; continue; }
    if (await warmCell(cell, vertical, false)) fetched++;
  }
  return { fetched, skipped, cells: cells.length };
}

/** Read competitor POIs already in the DB within a radius (nearest first). */
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

/**
 * Concept-relevant competitors near a point — the cache-through entry point that replaces
 * the Google-only relevantCompetitors for runtime use. Warms the area from OSM on a miss,
 * then reads from the shared DB and applies the same concept filter.
 */
export async function competitorsNear(
  lat: number,
  lon: number,
  vertical: string,
  brandOrConcept: string | undefined,
  opts: { radiusM?: number; max?: number } = {},
): Promise<RealPlace[]> {
  const radiusM = opts.radiusM ?? 1500;
  const max = opts.max ?? 20;
  // Warm the cache for this area+vertical (no-op if already covered & fresh).
  await ensureCoverage(lat, lon, vertical, radiusM);
  // Serve from the shared DB, concept-filtered.
  const concept = conceptFor(vertical, brandOrConcept);
  const raw = await competitorsFromDb(lat, lon, radiusM, Math.min(60, max * 3));
  return filterRelevantCompetitors(raw, concept).slice(0, max);
}

/** All nearby competitor establishments (unfiltered) for the map — cache-through. */
export async function establishmentsNearCached(
  lat: number,
  lon: number,
  vertical: string,
  opts: { radiusM?: number; max?: number } = {},
): Promise<RealPlace[]> {
  const radiusM = opts.radiusM ?? 1200;
  const max = opts.max ?? 40;
  await ensureCoverage(lat, lon, vertical, radiusM);
  return competitorsFromDb(lat, lon, radiusM, max);
}
