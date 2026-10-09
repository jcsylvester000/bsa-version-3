/**
 * Location demand + automated back-fill queue (2026-10-09).
 *
 *   user searches an address ─┐                     ┌─ covered → nothing to do
 *   user submits intake sites ┴─► recordDemand() ───┼─ partial / gap → enqueueFill() (intake sites;
 *                                 (what BSA had      │    searches only when an admin queues them)
 *                                  there right now)  └─ the run is flagged "gathering place data"
 *
 * The queue is worked by lib/services/autofill.ts (scheduled + admin "Run now"). Everything here
 * is bookkeeping: it never fails the user's request (errors are logged and swallowed).
 *
 * Privacy (RA 10173): we keep who searched what and where, for admins only, with no IP or device
 * data, and purge after 12 months (prisma/purgeDemand.ts).
 */
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { isUuid } from '@/lib/util/uuid';
import { resolveAdminBoundary } from '@/lib/geo/adminBoundary';
import { regionForPoint } from '@/lib/geo/regions';
import { coverageCellKey } from '@/lib/places/poiCache';
import { OSM_SELECTORS } from '@/lib/places/osmService';
import { ringPolicy } from '@/lib/capture/capturePolicy';
import { layerFreshness } from '@/lib/services/capture';
import { isLayerKey, type LayerKey } from '@/lib/capture/layers';
import type { CaptureArea } from '@/lib/capture/area';

/** Area checked around a demand point and filled by a job (capped at 1 km in dense centres). */
export const DEMAND_RADIUS_M = 1_500;
/** Context layers every analysis reads (anchors, transport, health, education). */
export const FILL_BASE_LAYERS: LayerKey[] = ['anchors', 'transport', 'health', 'education'];
/** At or above this many stored places within the radius, an area counts as covered even without
 *  capture stamps (e.g. NCR from the bulk ingest) — no job, so busy areas don't re-fetch. */
export const RICH_PLACES = 60;

export type CoverageStatus = 'covered' | 'partial' | 'gap';
export type DemandKind = 'search' | 'intake_site';

/**
 * Context layers whose places have their own POI category — used to spot a "rich" area that still has
 * none of a layer (data check 2026-10-09: NCR held ~18,000 competitor places but only a few hundred
 * transport stops, so the Accessibility pillar was missing on every NCR run).
 */
export const LAYER_CATEGORIES: Partial<Record<LayerKey, string[]>> = {
  transport: ['transport'],
  health: ['clinic', 'hospital', 'diagnostic'],
  education: ['school'],
};

/**
 * Pure rule (unit-tested): what BSA's data looks like around a point. `emptyLayers` = context layers
 * with no stored place of their category nearby and no fresh capture — a rich area missing one of them
 * is only 'partial' (that layer gets back-filled).
 */
export function classifyCoverage(placesNearby: number, freshLayers: number, totalLayers: number, emptyLayers = 0): CoverageStatus {
  if (placesNearby >= RICH_PLACES) return emptyLayers > 0 ? 'partial' : 'covered';
  if (totalLayers > 0 && freshLayers >= totalLayers) return 'covered';
  if (placesNearby === 0 && freshLayers === 0) return 'gap';
  return 'partial';
}

/** Stale context layers with no stored place of their category nearby. Pure (unit-tested). */
export function emptyContextLayers(staleLayers: LayerKey[], countsByCategory: Map<string, number>): LayerKey[] {
  return staleLayers.filter((l) => {
    const cats = LAYER_CATEGORIES[l];
    return !!cats && cats.every((c) => !(countsByCategory.get(c) ?? 0));
  });
}

/** ~1 km key so demand points close together share ONE job. */
export function fillAreaKey(lat: number, lon: number): string {
  return `f:${lat.toFixed(2)}:${lon.toFixed(2)}`;
}

/** Layers a job fills for a business type: its competitor set (when OSM has one) + the context layers. */
export function fillLayersFor(vertical: string | null | undefined): LayerKey[] {
  const out: LayerKey[] = [];
  const key = `v:${vertical}`;
  // 'other' has no meaningful competitor set; only layers Place Capture knows are queued.
  if (vertical && vertical !== 'other' && OSM_SELECTORS[vertical] && isLayerKey(key)) out.push(key as LayerKey);
  return [...out, ...FILL_BASE_LAYERS];
}

export function fillAreaFor(lat: number, lon: number): CaptureArea & { kind: 'circle' } {
  return { kind: 'circle', lat, lon, radiusM: Math.min(DEMAND_RADIUS_M, ringPolicy(lat, lon).maxM) };
}

export interface DemandInput {
  kind: DemandKind;
  userId?: string | null;
  franchisorId?: string | null;
  query?: string | null;
  label?: string | null;
  lat: number;
  lon: number;
  vertical?: string | null;
  runId?: string | null;
  siteId?: string | null;
  /** Queue a back-fill when the area is not covered (default: intake sites only). */
  enqueue?: boolean;
}

export interface DemandResult { id: string | null; status: CoverageStatus; placesNearby: number; jobId: string | null }

const clip = (v: string | null | undefined, n: number) => (v ? v.replace(/\s+/g, ' ').trim().slice(0, n) || null : null);

/** Record one demand point and (for intake sites) queue a back-fill where data is missing. Never throws. */
export async function recordDemand(input: DemandInput): Promise<DemandResult> {
  const empty: DemandResult = { id: null, status: 'covered', placesNearby: 0, jobId: null };
  if (!Number.isFinite(input.lat) || !Number.isFinite(input.lon)) return empty;
  try {
    const area = fillAreaFor(input.lat, input.lon);
    const layers = fillLayersFor(input.vertical);
    const [count, byCat, fresh, bnd] = await Promise.all([
      prisma.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM poi
        WHERE geom IS NOT NULL AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography, ${area.radiusM})`,
      prisma.$queryRaw<Array<{ category: string; n: number }>>`
        SELECT category::text AS category, COUNT(*)::int AS n FROM poi
        WHERE geom IS NOT NULL AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography, ${area.radiusM})
        GROUP BY category`,
      layerFreshness(area, layers),
      resolveAdminBoundary(input.lat, input.lon),
    ]);
    const placesNearby = count[0]?.n ?? 0;
    const catN = new Map(byCat.map((r) => [r.category, r.n]));
    const notFresh = fresh.filter((l) => !l.covered).map((l) => l.layer as LayerKey);
    const empty = emptyContextLayers(notFresh, catN);
    // Rich areas only back-fill the context layers they have none of; thin areas fill every stale layer.
    const missing = placesNearby >= RICH_PLACES ? empty : notFresh;
    const status = classifyCoverage(placesNearby, layers.length - notFresh.length, layers.length, empty.length);
    const where = [bnd?.barangay ? `Brgy ${bnd.barangay}` : null, bnd?.city].filter(Boolean).join(', ');

    let jobId: string | null = null;
    const wantJob = input.enqueue ?? input.kind === 'intake_site';
    if (status !== 'covered' && wantJob && missing.length) {
      jobId = await enqueueFill({
        lat: input.lat, lon: input.lon, layers: missing, reason: input.kind === 'intake_site' ? 'intake' : 'search',
        label: where || clip(input.label ?? input.query, 80) || `${input.lat.toFixed(4)}, ${input.lon.toFixed(4)}`,
        runId: input.runId ?? null, userId: input.userId ?? null,
      });
    }

    const rows = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO location_demand (kind, user_id, franchisor_id, query, label, lat, lon, cell_key, barangay, city, province, region,
                                   vertical, run_id, site_id, places_nearby, coverage_status, fill_job_id)
      VALUES (${input.kind}, ${uuidOrNull(input.userId)}::uuid, ${uuidOrNull(input.franchisorId)}::uuid, ${clip(input.query, 200)}, ${clip(input.label, 160)},
              ${input.lat}, ${input.lon}, ${coverageCellKey(input.lat, input.lon)}, ${bnd?.barangay ?? null}, ${bnd?.city ?? null}, ${bnd?.province ?? null},
              ${bnd?.region ?? regionForPoint(input.lat, input.lon)}, ${clip(input.vertical, 40)}, ${uuidOrNull(input.runId)}::uuid, ${uuidOrNull(input.siteId)}::uuid,
              ${placesNearby}, ${status}, ${jobId}::uuid)
      RETURNING id::text`;
    return { id: rows[0]?.id ?? null, status, placesNearby, jobId };
  } catch (e) {
    console.error('[demand] could not record demand', e);
    return empty;
  }
}

const uuidOrNull = (v: string | null | undefined) => (v && isUuid(v) ? v : null);

/**
 * Queue (or join) the back-fill job for the ~1 km area around a point. An open job for the same
 * area absorbs the request: more demand, the extra layers, and the waiting run. Returns the job id.
 */
export async function enqueueFill(input: {
  lat: number; lon: number; layers: LayerKey[]; reason: 'intake' | 'search' | 'admin'; label: string;
  runId?: string | null; userId?: string | null;
}): Promise<string | null> {
  const area = fillAreaFor(input.lat, input.lon);
  const runIds = input.runId && isUuid(input.runId) ? [input.runId] : [];
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    INSERT INTO poi_fill_job (area_key, label, lat, lon, radius_m, layers, reason, run_ids, created_by)
    VALUES (${fillAreaKey(input.lat, input.lon)}, ${input.label.slice(0, 160)}, ${input.lat}, ${input.lon}, ${area.radiusM},
            ${input.layers}::text[], ${input.reason}, ${runIds}::uuid[], ${uuidOrNull(input.userId)}::uuid)
    ON CONFLICT (area_key) WHERE status IN ('queued', 'running')
    DO UPDATE SET demand_count = poi_fill_job.demand_count + 1,
      layers = ARRAY(SELECT DISTINCT unnest(poi_fill_job.layers || EXCLUDED.layers)),
      run_ids = ARRAY(SELECT DISTINCT unnest(poi_fill_job.run_ids || EXCLUDED.run_ids))
    RETURNING id::text`);
  return rows[0]?.id ?? null;
}

/** After intake: flag the run as "gathering place data" when any of its sites queued a job. */
export async function markRunPending(runId: string): Promise<void> {
  if (!isUuid(runId)) return;
  try {
    await prisma.$executeRaw`
      UPDATE pipeline_run SET data_pending_at = COALESCE(data_pending_at, now()), data_refresh_state = 'waiting'
      WHERE id = ${runId}::uuid`;
  } catch (e) {
    console.error('[demand] could not flag run', e);
  }
}

/* ------------------------------------------------------------------ admin read side */

export async function demandOverview(opts: { days?: number } = {}) {
  const days = Math.min(365, Math.max(1, opts.days ?? 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const items = await prisma.$queryRaw<Array<{
    id: string; kind: DemandKind; email: string | null; query: string | null; label: string | null; lat: number; lon: number;
    barangay: string | null; city: string | null; province: string | null; region: string | null; vertical: string | null;
    run_id: string | null; places_nearby: number; coverage_status: CoverageStatus; fill_job_id: string | null; job_status: string | null; created_at: Date;
  }>>`
    SELECT d.id::text, d.kind, u.email, d.query, d.label, d.lat, d.lon, d.barangay, d.city, d.province, d.region, d.vertical,
           d.run_id::text, d.places_nearby, d.coverage_status, d.fill_job_id::text, j.status::text AS job_status, d.created_at
    FROM location_demand d
    LEFT JOIN app_user u ON u.id = d.user_id
    LEFT JOIN poi_fill_job j ON j.id = d.fill_job_id
    WHERE d.created_at >= ${since}
    ORDER BY d.created_at DESC
    LIMIT 1000`;
  const totals = await prisma.$queryRaw<Array<{ searches: number; sites: number; gaps: number; partial: number; users: number }>>`
    SELECT COUNT(*) FILTER (WHERE kind = 'search')::int AS searches, COUNT(*) FILTER (WHERE kind = 'intake_site')::int AS sites,
           COUNT(*) FILTER (WHERE coverage_status = 'gap')::int AS gaps, COUNT(*) FILTER (WHERE coverage_status = 'partial')::int AS partial,
           COUNT(DISTINCT user_id)::int AS users
    FROM location_demand WHERE created_at >= ${since}`;
  return {
    days,
    totals: totals[0] ?? { searches: 0, sites: 0, gaps: 0, partial: 0, users: 0 },
    items: items.map((r) => ({
      id: r.id, kind: r.kind, user: r.email, query: r.query, label: r.label, lat: r.lat, lon: r.lon, barangay: r.barangay, city: r.city,
      province: r.province, region: r.region, vertical: r.vertical, runId: r.run_id, placesNearby: r.places_nearby, coverageStatus: r.coverage_status,
      fillJobId: r.fill_job_id, jobStatus: r.job_status, createdAt: r.created_at,
    })),
  };
}

/** Queue a back-fill for one demand row (admin action, e.g. a search in a gap). */
export async function queueFillForDemand(demandId: string, userId: string | null) {
  if (!isUuid(demandId)) return null;
  const d = await prisma.locationDemand.findUnique({ where: { id: demandId } });
  if (!d) return null;
  const area = fillAreaFor(d.lat, d.lon);
  const missing = (await layerFreshness(area, fillLayersFor(d.vertical))).filter((l) => !l.covered).map((l) => l.layer as LayerKey);
  if (!missing.length) return { jobId: null, alreadyCovered: true };
  const label = [d.barangay ? `Brgy ${d.barangay}` : null, d.city].filter(Boolean).join(', ') || d.query || d.label || 'Requested area';
  const jobId = await enqueueFill({ lat: d.lat, lon: d.lon, layers: missing, reason: 'admin', label, runId: d.runId, userId });
  if (jobId) await prisma.$executeRaw`UPDATE location_demand SET fill_job_id = ${jobId}::uuid WHERE id = ${demandId}::uuid`;
  return { jobId, alreadyCovered: false };
}
