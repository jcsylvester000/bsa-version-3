/**
 * Admin POI capture service (2026-10-07) — the grid-navigator capture loop blended into BSA.
 *
 *   area pull (live OSM)  ┐
 *   .gridnav.json import  ├─► draft batch + staged items ─► admin review ─► commit ─► poi (+ PSGC tags)
 *   manual pins           ┘
 *
 * Every write to `poi` goes through commitBatch, admin-only, audit-logged. Nothing is written to
 * `poi` at preview/import time. Writes are sequential statements (Neon HTTP adapter: no interactive
 * transactions); commit is re-runnable — items already committed are skipped and keyed rows upsert.
 *
 * Truth Layer: live OSM = Verified; navigator imports and manual pins = Assumed until refreshed from
 * OSM or field-verified by an admin (verifyPoi). Imports never overwrite a place BSA already holds.
 */
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { audit } from '@/lib/audit/audit';
import { regionForPoint } from '@/lib/geo/regions';
import { resolveAdminBoundary } from '@/lib/geo/adminBoundary';
import { captureElementsInBbox, OSM_SELECTORS } from '@/lib/places/osmService';
import { claimLegacyOsmSql } from '@/lib/ingest/poiKeySql';
import { isBsaPoiCategory, type BsaPoiCategory } from '@/lib/places/osmCategory';
import { areaGeoJson, areaKm2, bboxOfArea, describeArea, MAX_CAPTURE_KM2, type CaptureArea } from '@/lib/capture/area';
import { BASE_LAYER_SELECTORS, isBaseLayer, keepsUnnamed, type LayerKey } from '@/lib/capture/layers';
import { mapElement, parseSelector, type SkipReason, type TagMatcher } from '@/lib/capture/mapElement';
import { cleanText, dedupeCandidates, MAX_NAME_LEN, MAX_NOTES_LEN, type CaptureCandidate } from '@/lib/capture/candidate';
import { parseNavigatorFile } from '@/lib/capture/navigatorFile';
import { catchmentFor, conceptForSite, summariseForTerritory, tierOfPlace, DEFAULT_SCAN_M, type TerritorySummary } from '@/lib/capture/territoryAlign';
import { haversineMeters } from '@/lib/geo/geo';
import { cellsForArea, coverageCellKey } from '@/lib/places/poiCache';
import { containsPoint } from '@/lib/capture/area';

/** Max elements one area pull returns (Overpass `out center N`). Hitting it = area too dense. */
const MAX_ELEMENTS = 5_000;
/** Time budget for the live Overpass call — keeps the request under the hosting function timeout. */
const PREVIEW_BUDGET_MS = 18_000;
/** Possible-duplicate radius / name similarity for unkeyed or new places. */
const DUP_RADIUS_M = 50;
const DUP_SIMILARITY = 0.6;

export class CaptureError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

const actorId = (u: SessionUser) => (isUuid(u.id) ? u.id : null);

/* ------------------------------------------------------------------ selectors */

/** Overpass selectors + matchers for the requested layers (constants only — never client text). */
export function selectorsForLayers(layers: LayerKey[]): { selectors: string[]; matchers: TagMatcher[] } {
  const selectors: string[] = [];
  const matchers: TagMatcher[] = [];
  const seen = new Set<string>();
  for (const layer of layers) {
    const list = isBaseLayer(layer) ? BASE_LAYER_SELECTORS[layer] : OSM_SELECTORS[layer.slice(2)] ?? [];
    for (const sel of list) {
      if (seen.has(sel)) continue;
      const m = parseSelector(sel, keepsUnnamed(layer));
      if (!m) continue; // bare-key selectors (e.g. '"shop"') are too broad for an admin pull
      seen.add(sel);
      selectors.push(sel);
      matchers.push(m);
    }
  }
  return { selectors, matchers };
}

/* ------------------------------------------------------------------ staging */

async function createBatch(user: SessionUser, data: { label: string; source: 'osm' | 'navigator_import' | 'manual'; area?: CaptureArea; layers?: string[]; notes?: string | null; context?: SiteContext }) {
  const batch = await prisma.poiCaptureBatch.create({
    data: {
      label: cleanText(data.label, 120) || 'Capture',
      source: data.source,
      areaSpec: data.area ? ({ ...data.area, context: data.context ?? null } as unknown as Prisma.InputJsonValue) : undefined,
      layers: data.layers ?? [],
      notes: data.notes ?? null,
      createdById: actorId(user),
    },
    select: { id: true },
  });
  if (data.area) {
    const gj = JSON.stringify(areaGeoJson(data.area));
    await prisma.$executeRaw`
      UPDATE poi_capture_batch SET area = ST_SetSRID(ST_GeomFromGeoJSON(${gj}), 4326)::geography
      WHERE id = ${batch.id}::uuid`;
  }
  return batch.id;
}

/**
 * Stage candidates into a batch, then annotate them against `poi`:
 *  - same OSM element already stored → existing_poi_id (live pulls refresh it; imports skip it);
 *  - no key match but a similarly-named place within 50 m → duplicate_of_poi_id, decision pending.
 */
async function stageItems(batchId: string, candidates: CaptureCandidate[], mode: 'live' | 'import' | 'manual'): Promise<void> {
  const CHUNK = 500;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    await prisma.poiCaptureItem.createMany({
      data: candidates.slice(i, i + CHUNK).map((c) => ({
        batchId,
        osmType: c.osmType,
        osmId: c.osmId != null ? BigInt(c.osmId) : null,
        name: c.name,
        kind: c.kind,
        category: c.category,
        lat: c.lat,
        lon: c.lon,
        source: c.source,
        truthLayer: c.truthLayer,
        decision: c.needsReview ? 'pending' : 'accept',
        notes: c.notes ?? null,
      })),
    });
  }

  // Same OSM element already in poi (typed key, or a legacy typeless row with the id nearby).
  await prisma.$executeRaw`
    UPDATE poi_capture_item i SET existing_poi_id = p.id
    FROM poi p
    WHERE i.batch_id = ${batchId}::uuid AND i.osm_id IS NOT NULL AND p.osm_id = i.osm_id
      AND (p.osm_type = i.osm_type
           OR (p.osm_type IS NULL AND p.geom IS NOT NULL
               AND ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint(i.lon, i.lat), 4326)::geography, 150)))`;

  if (mode === 'import') {
    await prisma.$executeRaw`
      UPDATE poi_capture_item SET decision = 'reject',
        notes = 'Already in BSA — imports never overwrite stored places. Re-capture the area from OSM to refresh it.'
      WHERE batch_id = ${batchId}::uuid AND existing_poi_id IS NOT NULL`;
  }

  // Possible duplicates: a similarly-named stored place within 50 m (pg_trgm similarity).
  await prisma.$executeRaw`
    UPDATE poi_capture_item i SET duplicate_of_poi_id = d.pid, decision = 'pending'
    FROM (
      SELECT i2.id AS iid, (
        SELECT p.id FROM poi p
        WHERE p.geom IS NOT NULL
          AND ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint(i2.lon, i2.lat), 4326)::geography, ${DUP_RADIUS_M})
          AND similarity(lower(p.name), lower(i2.name)) >= ${DUP_SIMILARITY}
        ORDER BY ST_Distance(p.geom, ST_SetSRID(ST_MakePoint(i2.lon, i2.lat), 4326)::geography)
        LIMIT 1) AS pid
      FROM poi_capture_item i2
      WHERE i2.batch_id = ${batchId}::uuid AND i2.existing_poi_id IS NULL AND i2.decision <> 'reject'
    ) d
    WHERE i.id = d.iid AND d.pid IS NOT NULL`;

  const n = await prisma.poiCaptureItem.count({ where: { batchId } });
  await prisma.poiCaptureBatch.update({ where: { id: batchId }, data: { itemCount: n } });
  void mode;
}

async function boundaryNote(lat: number, lon: number): Promise<string | null> {
  const b = await resolveAdminBoundary(lat, lon);
  return b ? null : 'PSGC boundaries are not loaded for this area yet — places will save with coordinates and a coarse region, without barangay/city. Load boundaries (db:fetch-boundaries) and run db:tag-boundaries to fill them in.';
}

/* ------------------------------------------------------------------ actions */

/** Territory Guard context for a capture: the site pin, the franchise vertical/brand and the format. */
export interface SiteContext { site?: { lat: number; lon: number }; vertical?: string; brand?: string; format?: string }
export interface PreviewInput { area: CaptureArea; layers: LayerKey[]; label?: string; context?: SiteContext }

export async function previewArea(user: SessionUser, input: PreviewInput) {
  const km2 = areaKm2(input.area);
  if (km2 > MAX_CAPTURE_KM2) {
    throw new CaptureError('area_too_large', `This area is about ${km2.toFixed(1)} km². One capture can cover up to ${MAX_CAPTURE_KM2} km² — draw a smaller area, or use the province sweep (npm run db:ingest:osm) for whole regions.`, 422);
  }
  const { selectors, matchers } = selectorsForLayers(input.layers);
  if (!selectors.length) throw new CaptureError('no_layers', 'Pick at least one layer to capture.', 422);

  let elements;
  try {
    elements = await captureElementsInBbox(selectors, bboxOfArea(input.area), { max: MAX_ELEMENTS, budgetMs: PREVIEW_BUDGET_MS });
  } catch {
    throw new CaptureError('osm_unavailable', 'OpenStreetMap did not answer in time. Try a smaller area or fewer layers, or try again in a minute.', 502);
  }

  const skipped: Record<SkipReason, number> = { no_coords: 0, no_match: 0, unnamed: 0, outside_area: 0 };
  const mapped: CaptureCandidate[] = [];
  for (const el of elements) {
    const r = mapElement(el, matchers, input.area);
    if (typeof r === 'string') skipped[r]++;
    else mapped.push(r);
  }
  const { kept } = dedupeCandidates(mapped);

  const notes: string[] = [];
  if (elements.length >= MAX_ELEMENTS) notes.push(`OpenStreetMap returned the maximum of ${MAX_ELEMENTS} places — this area is dense. Capture it in smaller pieces so nothing is cut off.`);
  const [s, w, n, e] = bboxOfArea(input.area);
  const bn = await boundaryNote((s + n) / 2, (w + e) / 2);
  if (bn) notes.push(bn);

  const batchId = await createBatch(user, {
    label: input.label || `OSM capture — ${describeArea(input.area)}`,
    source: 'osm',
    area: input.area,
    layers: input.layers,
    notes: notes.join('\n') || null,
    context: input.context,
  });
  await stageItems(batchId, kept, 'live');
  await audit({ actorId: actorId(user), action: 'poi.capture.preview', entity: 'poi_capture_batch', entityId: batchId, meta: { km2: Number(km2.toFixed(2)), layers: input.layers, staged: kept.length, skipped } });
  return { batchId, staged: kept.length, skipped, notes };
}

export async function importNavigator(user: SessionUser, raw: unknown, fileName: string) {
  const parsed = parseNavigatorFile(raw);
  const s = parsed.stats;
  const notes = [
    `Imported from ${cleanText(fileName, 80) || 'a Grid Navigator session'}: ${s.pois} places, ${s.checkpoints} checkpoints.`,
    s.skippedUnnamed ? `${s.skippedUnnamed} unnamed places skipped (BSA never invents a name).` : '',
    s.skippedInvalid ? `${s.skippedInvalid} rows skipped (invalid id or outside the Philippines).` : '',
    s.tilesIgnored ? `${s.tilesIgnored} cached map tiles ignored (not stored).` : '',
    s.checkpoints ? 'Checkpoints arrive as manual pins — choose a category for each before committing.' : '',
  ].filter(Boolean).join('\n');
  const batchId = await createBatch(user, { label: `Navigator import — ${cleanText(fileName, 60) || 'session'}`, source: 'navigator_import', notes });
  await stageItems(batchId, parsed.candidates, 'import');
  await audit({ actorId: actorId(user), action: 'poi.capture.import', entity: 'poi_capture_batch', entityId: batchId, meta: { ...s } });
  return { batchId, staged: parsed.candidates.length, stats: s };
}

export interface ManualPinInput { batchId?: string; lat: number; lon: number; name: string; category: BsaPoiCategory; notes?: string }

export async function addManualPin(user: SessionUser, input: ManualPinInput) {
  let batchId = input.batchId ?? null;
  if (batchId) {
    const b = await prisma.poiCaptureBatch.findUnique({ where: { id: batchId }, select: { status: true } });
    if (!b) throw new CaptureError('not_found', 'Capture batch not found.', 404);
    if (b.status !== 'draft') throw new CaptureError('not_draft', 'This batch is already committed or discarded — start a new one.', 409);
  } else {
    batchId = await createBatch(user, { label: 'Manual pins', source: 'manual' });
  }
  const name = cleanText(input.name, MAX_NAME_LEN);
  if (!name) throw new CaptureError('name_required', 'Give the place a name.', 422);
  await stageItems(batchId, [{
    osmType: null, osmId: null, name, kind: null, category: input.category,
    lat: input.lat, lon: input.lon, source: 'manual', truthLayer: 'assumed',
    notes: cleanText(input.notes ?? '', MAX_NOTES_LEN) || null,
  }], 'manual');
  return { batchId };
}

export async function listBatches(limit = 30) {
  const rows = await prisma.poiCaptureBatch.findMany({
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
    select: {
      id: true, label: true, source: true, status: true, itemCount: true, committedCount: true,
      layers: true, createdAt: true, committedAt: true, createdBy: { select: { email: true } },
    },
  });
  return rows.map((r) => ({ ...r, createdBy: r.createdBy?.email ?? null }));
}

export async function getBatch(batchId: string) {
  const batch = await prisma.poiCaptureBatch.findUnique({
    where: { id: batchId },
    select: {
      id: true, label: true, source: true, status: true, itemCount: true, committedCount: true, layers: true,
      areaSpec: true, notes: true, createdAt: true, committedAt: true, createdBy: { select: { email: true } },
    },
  });
  if (!batch) return null;
  const items = await prisma.poiCaptureItem.findMany({
    where: { batchId },
    orderBy: [{ decision: 'asc' }, { name: 'asc' }],
    take: 5_000,
  });
  const counts = { accept: 0, reject: 0, pending: 0, existing: 0, duplicates: 0 };
  for (const it of items) {
    counts[it.decision]++;
    if (it.existingPoiId != null) counts.existing++;
    if (it.duplicateOfPoiId != null) counts.duplicates++;
  }
  return {
    batch: { ...batch, createdBy: batch.createdBy?.email ?? null },
    counts,
    items: items.map((it) => ({
      id: it.id.toString(),
      osmRef: it.osmType && it.osmId != null ? `${it.osmType}/${it.osmId}` : null,
      name: it.name, kind: it.kind, category: it.category, lat: it.lat, lon: it.lon,
      source: it.source, truthLayer: it.truthLayer, decision: it.decision,
      existingPoiId: it.existingPoiId?.toString() ?? null,
      duplicateOfPoiId: it.duplicateOfPoiId?.toString() ?? null,
      committedPoiId: it.committedPoiId?.toString() ?? null,
      notes: it.notes,
    })),
  };
}

export interface ItemUpdate { id: string; decision?: 'accept' | 'reject' | 'pending'; name?: string; category?: BsaPoiCategory }

export async function updateItems(user: SessionUser, batchId: string, updates: ItemUpdate[]) {
  const b = await prisma.poiCaptureBatch.findUnique({ where: { id: batchId }, select: { status: true, source: true } });
  if (!b) throw new CaptureError('not_found', 'Capture batch not found.', 404);
  if (b.status !== 'draft') throw new CaptureError('not_draft', 'Only a draft batch can be edited.', 409);
  let changed = 0;
  for (const u of updates) {
    const data: Prisma.PoiCaptureItemUpdateManyMutationInput = {};
    if (u.decision) data.decision = u.decision;
    if (u.name !== undefined) {
      const name = cleanText(u.name, MAX_NAME_LEN);
      if (!name) throw new CaptureError('name_required', 'A place name cannot be empty.', 422);
      data.name = name;
    }
    if (u.category) {
      if (!isBsaPoiCategory(u.category)) throw new CaptureError('bad_category', 'Unknown category.', 422);
      data.category = u.category;
    }
    if (!Object.keys(data).length) continue;
    // An import must never overwrite a stored place, even if the reviewer flips the decision.
    const guard: Prisma.PoiCaptureItemWhereInput = b.source === 'navigator_import' && u.decision === 'accept' ? { existingPoiId: null } : {};
    const r = await prisma.poiCaptureItem.updateMany({ where: { id: BigInt(u.id), batchId, committedPoiId: null, ...guard }, data });
    changed += r.count;
  }
  if (changed) await audit({ actorId: actorId(user), action: 'poi.capture.review', entity: 'poi_capture_batch', entityId: batchId, meta: { changed } });
  return { changed };
}

export async function discardBatch(user: SessionUser, batchId: string) {
  const r = await prisma.poiCaptureBatch.updateMany({ where: { id: batchId, status: 'draft' }, data: { status: 'discarded' } });
  if (!r.count) throw new CaptureError('not_draft', 'Only a draft batch can be discarded.', 409);
  await audit({ actorId: actorId(user), action: 'poi.capture.discard', entity: 'poi_capture_batch', entityId: batchId });
  return { discarded: true };
}

/**
 * Write a batch's accepted items into `poi`. Admin-only (enforced by the route). Re-runnable:
 * already-committed items are skipped and OSM-keyed rows upsert on (osm_type, osm_id).
 */
export async function commitBatch(user: SessionUser, batchId: string) {
  const b = await prisma.poiCaptureBatch.findUnique({ where: { id: batchId }, select: { status: true, source: true } });
  if (!b) throw new CaptureError('not_found', 'Capture batch not found.', 404);
  if (b.status !== 'draft') throw new CaptureError('not_draft', 'This batch is already committed or discarded.', 409);
  const pending = await prisma.poiCaptureItem.count({ where: { batchId, decision: 'pending' } });
  if (pending > 0) throw new CaptureError('pending_items', `${pending} item(s) still need a decision (possible duplicates or uncategorised pins). Accept or reject them first.`, 409);

  const items = await prisma.poiCaptureItem.findMany({ where: { batchId, decision: 'accept', committedPoiId: null } });
  const isImport = b.source === 'navigator_import';
  const provenance = `${isImport ? 'osm:navigator-import' : 'osm:admin-capture'}:${batchId}`;
  const keyed = items.filter((i) => i.osmType && i.osmId != null && !(isImport && i.existingPoiId != null));
  const manual = items.filter((i) => !i.osmType || i.osmId == null);

  const CHUNK = 300;
  for (let i = 0; i < keyed.length; i += CHUNK) {
    const chunk = keyed.slice(i, i + CHUNK);
    await prisma.$executeRaw(claimLegacyOsmSql(chunk.map((c) => ({ osmType: c.osmType as 'node' | 'way' | 'relation', osmId: c.osmId!, lat: c.lat, lon: c.lon }))));
    const values = Prisma.join(chunk.map((c) => Prisma.sql`(
      ${c.name}, ${c.category}::"PoiCategory", ${c.lat}, ${c.lon}, ${regionForPoint(c.lat, c.lon)},
      'osm'::"PoiSource", ${provenance}, ${c.truthLayer}::"TruthLayer", ${c.osmId}, ${c.osmType}, ${c.kind}, ${batchId}::uuid)`));
    // Live OSM refreshes a stored element; an import only adds new elements (never overwrites).
    const onConflict = isImport
      ? Prisma.sql`ON CONFLICT (osm_type, osm_id) DO NOTHING`
      : Prisma.sql`ON CONFLICT (osm_type, osm_id) DO UPDATE SET
          name = EXCLUDED.name, category = EXCLUDED.category, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
          kind = EXCLUDED.kind, source = EXCLUDED.source, provenance = EXCLUDED.provenance,
          truth_layer = EXCLUDED.truth_layer, capture_batch_id = EXCLUDED.capture_batch_id,
          region = COALESCE(poi.region, EXCLUDED.region)`;
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO poi (name, category, lat, lon, region, source, provenance, truth_layer, osm_id, osm_type, kind, capture_batch_id)
      VALUES ${values}
      ${onConflict}`);
  }
  // Link each keyed item to the row that now holds its key.
  await prisma.$executeRaw`
    UPDATE poi_capture_item i SET committed_poi_id = p.id
    FROM poi p
    WHERE i.batch_id = ${batchId}::uuid AND i.decision = 'accept' AND i.committed_poi_id IS NULL
      AND i.osm_id IS NOT NULL AND p.osm_type = i.osm_type AND p.osm_id = i.osm_id`;

  for (const m of manual) {
    const rows = await prisma.$queryRaw<Array<{ id: bigint }>>`
      INSERT INTO poi (name, category, lat, lon, region, source, provenance, truth_layer, capture_batch_id)
      VALUES (${m.name}, ${m.category}::"PoiCategory", ${m.lat}, ${m.lon}, ${regionForPoint(m.lat, m.lon)},
              'manual'::"PoiSource", ${`manual:admin-capture:${batchId}`}, ${m.truthLayer}::"TruthLayer", ${batchId}::uuid)
      RETURNING id`;
    if (rows[0]) await prisma.poiCaptureItem.update({ where: { id: m.id }, data: { committedPoiId: rows[0].id } });
  }

  // PSGC tags for everything this batch wrote (barangay / city / province / registry region).
  const tagged = await prisma.$executeRaw`
    UPDATE poi p SET psgc_code = sub.psgc, barangay = sub.bgy, city = sub.city, province = sub.prov,
      region = COALESCE(sub.region, p.region)
    FROM (
      SELECT p2.id AS pid, b.psgc_code AS psgc, b.name AS bgy, b.region AS region, c.name AS city, pr.name AS prov
      FROM poi p2
      JOIN LATERAL (
        SELECT ab.* FROM admin_boundary ab
        WHERE ab.level = 'barangay' AND ab.geom IS NOT NULL AND ST_Intersects(ab.geom, p2.geom)
        LIMIT 1
      ) b ON true
      LEFT JOIN admin_boundary c  ON c.psgc_code  = b.parent_psgc
      LEFT JOIN admin_boundary pr ON pr.psgc_code = c.parent_psgc
      WHERE p2.capture_batch_id = ${batchId}::uuid AND p2.geom IS NOT NULL
    ) sub
    WHERE p.id = sub.pid`;

  const coverageStamped = await stampCoverage(batchId);

  const committed = await prisma.poiCaptureItem.count({ where: { batchId, committedPoiId: { not: null } } });
  const skippedExisting = isImport ? items.filter((i) => i.existingPoiId != null).length : 0;
  await prisma.poiCaptureBatch.update({
    where: { id: batchId },
    data: { status: 'committed', committedCount: committed, committedAt: new Date(), committedById: actorId(user) },
  });
  await audit({ actorId: actorId(user), action: 'poi.capture.commit', entity: 'poi_capture_batch', entityId: batchId, meta: { committed, keyed: keyed.length, manual: manual.length, psgcTagged: tagged, skippedExisting, coverageStamped } });
  return { committed, psgcTagged: tagged, skippedExisting, coverageStamped };
}

/** Committed capture areas + POI totals per region, for the coverage overlay. */
export async function coverage() {
  const areas = await prisma.$queryRaw<Array<{ id: string; label: string; committed_count: number; committed_at: Date | null; geojson: string | null }>>`
    SELECT id::text, label, committed_count, committed_at, ST_AsGeoJSON(area)::text AS geojson
    FROM poi_capture_batch
    WHERE status = 'committed' AND area IS NOT NULL
    ORDER BY committed_at DESC
    LIMIT 500`;
  const regions = await prisma.$queryRaw<Array<{ region: string | null; total: number; manual: number; verified: number; tagged: number }>>`
    SELECT region, COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE source = 'manual')::int AS manual,
           COUNT(*) FILTER (WHERE truth_layer = 'verified')::int AS verified,
           COUNT(*) FILTER (WHERE psgc_code IS NOT NULL)::int AS tagged
    FROM poi GROUP BY region ORDER BY total DESC`;
  return {
    areas: areas.map((a) => ({ id: a.id, label: a.label, committedCount: a.committed_count, committedAt: a.committed_at, geometry: a.geojson ? JSON.parse(a.geojson) : null })),
    regions,
  };
}

/** Field-confirm a manual pin → Verified. Admin-only (route), audit-logged. */
export async function verifyPoi(user: SessionUser, poiId: bigint) {
  const p = await prisma.poi.findUnique({ where: { id: poiId }, select: { source: true, truthLayer: true } });
  if (!p) throw new CaptureError('not_found', 'Place not found.', 404);
  if (p.source !== 'manual') throw new CaptureError('not_manual', 'Only manual pins are field-verified here; OSM places are refreshed by re-capturing the area.', 409);
  await prisma.poi.update({ where: { id: poiId }, data: { truthLayer: 'verified', verifiedAt: new Date(), verifiedById: actorId(user) } });
  await audit({ actorId: actorId(user), action: 'poi.verify', entity: 'poi', entityId: poiId.toString(), meta: { from: p.truthLayer } });
  return { verified: true };
}

/** Committed POIs inside a bbox (map context while reviewing). Read-only, capped. */
export async function poisInBbox(bbox: [number, number, number, number], limit = 2_000) {
  const [s, w, n, e] = bbox;
  const rows = await prisma.$queryRaw<Array<{ id: bigint; name: string; category: string; lat: number; lon: number; source: string; truth_layer: string; barangay: string | null; city: string | null }>>`
    SELECT id, name, category::text, lat, lon, source::text, truth_layer::text, barangay, city
    FROM poi
    WHERE geom && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography
    LIMIT ${Math.min(5_000, Math.max(1, limit))}`;
  return rows.map((r) => ({ ...r, id: r.id.toString() }));
}

/**
 * Tell Territory Guard's on-demand cache that a captured area is covered for the captured
 * competitor verticals: every ~1.1 km coverage cell whose centre lies inside the capture area gets
 * a fresh `poi_coverage` stamp (source 'admin_capture'). Without it, the first report there would
 * re-pull the same places from OpenStreetMap. Only live OSM batches with an area stamp coverage.
 */
async function stampCoverage(batchId: string): Promise<number> {
  const b = await prisma.poiCaptureBatch.findUnique({ where: { id: batchId }, select: { source: true, areaSpec: true, layers: true } });
  if (!b || b.source !== 'osm' || !b.areaSpec) return 0;
  const area = b.areaSpec as unknown as CaptureArea;
  const verticals = b.layers.filter((l) => l.startsWith('v:')).map((l) => l.slice(2)).filter((v) => OSM_SELECTORS[v]);
  if (!verticals.length) return 0;
  const [s, w, n, e] = bboxOfArea(area);
  const cLat = (s + n) / 2, cLon = (w + e) / 2;
  const radius = haversineMeters({ lat: cLat, lon: cLon }, { lat: n, lon: e });
  const cells = cellsForArea(cLat, cLon, radius).filter((c) => containsPoint(area, c.lat, c.lon));
  let stamped = 0;
  for (const v of verticals) {
    for (const c of cells) {
      const key = coverageCellKey(c.lat, c.lon);
      await prisma.poiCoverage.upsert({
        where: { coverage_cell_vertical: { cellKey: key, vertical: v } },
        create: { cellKey: key, vertical: v, lat: c.lat, lon: c.lon, poiCount: 0, source: 'admin_capture' },
        update: { fetchedAt: new Date(), source: 'admin_capture' },
      });
      stamped++;
    }
  }
  return stamped;
}

export interface ReadinessInput { lat: number; lon: number; radiusM?: number; format?: string; vertical?: string; brand?: string }

/**
 * "What Territory Guard sees here right now" for a site pin — the same query, tiers, catchment
 * radii and saturation curve the module uses, plus where the pin falls (PSGC barangay / city /
 * province) so the admin can confirm the coordinate before capturing.
 */
export async function siteReadiness(input: ReadinessInput) {
  const radiusM = Math.min(3_000, Math.max(200, input.radiusM ?? DEFAULT_SCAN_M));
  const catchmentM = catchmentFor(input.format);
  const concept = conceptForSite(input.vertical, input.brand);
  const boundary = await resolveAdminBoundary(input.lat, input.lon);
  const rows = await prisma.$queryRaw<Array<{ id: bigint; name: string; category: string; lat: number; lon: number; source: string; truth_layer: string }>>`
    SELECT id, name, category::text AS category, lat, lon, source::text AS source, truth_layer::text AS truth_layer
    FROM poi
    WHERE geom IS NOT NULL
      AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography, ${radiusM})
    ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography) ASC
    LIMIT 1500`;
  const places = rows.map((r) => {
    const distM = Math.round(haversineMeters({ lat: input.lat, lon: input.lon }, { lat: r.lat, lon: r.lon }));
    return { id: r.id.toString(), name: r.name, category: r.category, lat: r.lat, lon: r.lon, source: r.source, truthLayer: r.truth_layer, distM, tier: tierOfPlace(r, concept) };
  });
  const summary: TerritorySummary = summariseForTerritory(places, catchmentM);
  let coverage: { cells: number; fresh: number } | null = null;
  if (input.vertical && OSM_SELECTORS[input.vertical]) {
    const cells = cellsForArea(input.lat, input.lon, radiusM);
    const keys = cells.map((c) => coverageCellKey(c.lat, c.lon));
    const fresh = await prisma.poiCoverage.count({
      where: { vertical: input.vertical, cellKey: { in: keys }, fetchedAt: { gte: new Date(Date.now() - 90 * 24 * 3600 * 1000) } },
    });
    coverage = { cells: keys.length, fresh };
  }
  return {
    site: { lat: input.lat, lon: input.lon },
    boundary,
    region: boundary?.region ?? regionForPoint(input.lat, input.lon),
    catchmentM,
    radiusM,
    concept: concept ? { key: concept.key, label: concept.label } : null,
    summary,
    coverage,
    places: places.slice(0, 600),
    capped: rows.length >= 1500,
  };
}

