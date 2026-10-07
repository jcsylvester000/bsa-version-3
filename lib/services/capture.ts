/**
 * Admin Place Capture service (2026-10-07, v2 — "show on the map first, then save").
 *
 *   area pull (live OSM) ┐                                   ┌─► admin reviews ON THE MAP ─► Save ─► poi
 *   .gridnav.json file   ├─► candidates (NOTHING written) ───┤                                 (+ PSGC tags,
 *   manual pins (browser)┘                                   └─► nothing saved if they leave    coverage, audit)
 *
 * Preview and import are READ-ONLY: they fetch/parse, mark what BSA already holds (best-effort read)
 * and return the places for display. The ONLY write path is saveCapture(), admin-only, which records
 * a committed batch (audit trail of exactly what was saved), writes `poi`, tags PSGC barangay/city/
 * province, stamps Territory Guard's coverage cells and writes audit_log. Writes are sequential
 * statements (Neon HTTP adapter: no interactive transactions) and idempotent on the OSM key.
 *
 * Truth Layer: OSM places with a valid preview receipt (lib/capture/signing) = Verified; edited OSM
 * places, Grid Navigator imports and manual pins = Assumed, and those never overwrite a stored place.
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
import type { BsaPoiCategory } from '@/lib/places/osmCategory';
import { areaGeoJson, areaKm2, bboxOfArea, containsPoint, describeArea, MAX_CAPTURE_KM2, type CaptureArea } from '@/lib/capture/area';
import { BASE_LAYER_SELECTORS, isBaseLayer, keepsUnnamed, type LayerKey } from '@/lib/capture/layers';
import { mapElement, parseSelector, type SkipReason, type TagMatcher } from '@/lib/capture/mapElement';
import { cleanText, dedupeCandidates, parseOsmRef, MAX_NAME_LEN, MAX_NOTES_LEN, type CaptureCandidate } from '@/lib/capture/candidate';
import { parseNavigatorFile } from '@/lib/capture/navigatorFile';
import { signCandidate, verifyCandidate } from '@/lib/capture/signing';
import { catchmentFor, conceptForSite, summariseForTerritory, tierOfPlace, DEFAULT_SCAN_M, type TerritorySummary } from '@/lib/capture/territoryAlign';
import { haversineMeters } from '@/lib/geo/geo';
import { cellsForArea, coverageCellKey } from '@/lib/places/poiCache';

/** Max elements one area pull returns (Overpass `out center N`). Hitting it = area too dense. */
const MAX_ELEMENTS = 5_000;
/** Time budget for the live Overpass call — keeps the request under the hosting function timeout. */
const PREVIEW_BUDGET_MS = 18_000;
/** Possible-duplicate radius / name similarity for unkeyed places. */
const DUP_RADIUS_M = 50;
const DUP_SIMILARITY = 0.6;
/** Most places one save may write. */
export const MAX_SAVE_ITEMS = 5_000;

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

/* ------------------------------------------------------------------ candidates (read-only) */

/** A place returned for display. `receipt` is present only for unedited live-OSM places. */
export interface PreviewCandidate {
  key: string;
  osmRef: string | null;
  name: string;
  kind: string | null;
  category: BsaPoiCategory;
  lat: number;
  lon: number;
  origin: 'osm' | 'file' | 'manual';
  truthLayer: 'verified' | 'assumed';
  receipt?: string;
  /** Same OSM element already stored in BSA (saving refreshes it; a file import leaves it alone). */
  existingPoiId: string | null;
  /** A similarly-named stored place within 50 m — reviewer decides. */
  duplicateOf: { id: string; name: string } | null;
  needsReview?: boolean;
  notes?: string | null;
}

function toPreview(c: CaptureCandidate, origin: 'osm' | 'file'): PreviewCandidate {
  const osmRef = c.osmType && c.osmId != null ? `${c.osmType}/${c.osmId}` : null;
  const signed = origin === 'osm' && osmRef;
  return {
    key: osmRef ?? `m:${c.name.toLowerCase()}:${c.lat.toFixed(5)}:${c.lon.toFixed(5)}`,
    osmRef,
    name: c.name,
    kind: c.kind,
    category: c.category,
    lat: c.lat,
    lon: c.lon,
    origin: osmRef ? origin : 'manual',
    truthLayer: signed ? 'verified' : 'assumed',
    receipt: signed ? signCandidate({ osmRef: osmRef!, name: c.name, kind: c.kind, lat: c.lat, lon: c.lon }) : undefined,
    existingPoiId: null,
    duplicateOf: null,
    needsReview: c.needsReview,
    notes: c.notes ?? null,
  };
}

/**
 * Mark candidates BSA already holds — READ-ONLY and best-effort: if the database can't be read the
 * places still display (with a note), because the map preview must never depend on a DB write.
 */
async function markKnown(list: PreviewCandidate[]): Promise<string | null> {
  try {
    const CHUNK = 400;
    for (let i = 0; i < list.length; i += CHUNK) {
      const chunk = list.slice(i, i + CHUNK);
      const values = Prisma.join(chunk.map((c, j) => {
        const ref = c.osmRef ? parseOsmRef(c.osmRef) : null;
        return Prisma.sql`(${j}::int, ${ref?.osmType ?? null}::text, ${ref ? BigInt(ref.osmId) : null}::bigint, ${c.lat}::float8, ${c.lon}::float8, ${c.name}::text)`;
      }));
      // Function form (Prisma.sql) — nested Prisma.join fragments are not reliable inside the tagged form.
      const rows = await prisma.$queryRaw<Array<{ idx: number; existing_id: bigint | null; dup_id: bigint | null; dup_name: string | null }>>(Prisma.sql`
        SELECT v.idx,
          (SELECT p.id FROM poi p
             WHERE v.oid IS NOT NULL AND p.osm_id = v.oid
               AND (p.osm_type = v.t OR (p.osm_type IS NULL AND p.geom IS NOT NULL
                    AND ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography, 150)))
             LIMIT 1) AS existing_id,
          d.id AS dup_id, d.name AS dup_name
        FROM (VALUES ${values}) AS v(idx, t, oid, lat, lon, name)
        LEFT JOIN LATERAL (
          SELECT p.id, p.name FROM poi p
          WHERE p.geom IS NOT NULL
            AND ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography, ${DUP_RADIUS_M})
            AND similarity(lower(p.name), lower(v.name)) >= ${DUP_SIMILARITY}
            AND (v.oid IS NULL OR p.osm_id IS DISTINCT FROM v.oid)
          ORDER BY ST_Distance(p.geom, ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography)
          LIMIT 1
        ) d ON true`);
      for (const r of rows) {
        const c = chunk[Number(r.idx)];
        if (!c) continue;
        c.existingPoiId = r.existing_id != null ? r.existing_id.toString() : null;
        // A duplicate only matters when this isn't the same OSM element already stored.
        c.duplicateOf = !c.existingPoiId && r.dup_id != null ? { id: r.dup_id.toString(), name: r.dup_name ?? '' } : null;
      }
    }
    return null;
  } catch (e) {
    console.error('[capture] could not check places against BSA (display continues)', e);
    return 'Could not check these places against what BSA already holds (database unreachable). You can still review them; saving will skip anything already stored.';
  }
}

async function boundaryNote(lat: number, lon: number): Promise<string | null> {
  const b = await resolveAdminBoundary(lat, lon);
  return b ? null : 'PSGC boundaries are not loaded for this area yet — places will save with exact coordinates and a coarse region, without barangay/city. Load boundaries (db:fetch-boundaries) and run db:tag-boundaries to fill them in.';
}

export interface SiteContext { site?: { lat: number; lon: number }; vertical?: string; brand?: string; format?: string }
export interface PreviewInput { area: CaptureArea; layers: LayerKey[] }

/** Pull places for an area from OpenStreetMap and return them for the map. Writes NOTHING. */
export async function previewArea(user: SessionUser, input: PreviewInput) {
  const km2 = areaKm2(input.area);
  if (km2 > MAX_CAPTURE_KM2) {
    throw new CaptureError('area_too_large', `This area is about ${km2.toFixed(1)} km². One capture can cover up to ${MAX_CAPTURE_KM2} km² — make the ring smaller, or use the province sweep (npm run db:ingest:osm) for whole regions.`, 422);
  }
  const { selectors, matchers } = selectorsForLayers(input.layers);
  if (!selectors.length) throw new CaptureError('no_layers', 'Pick at least one layer to capture.', 422);

  let elements;
  try {
    elements = await captureElementsInBbox(selectors, bboxOfArea(input.area), { max: MAX_ELEMENTS, budgetMs: PREVIEW_BUDGET_MS });
  } catch {
    throw new CaptureError('osm_unavailable', 'OpenStreetMap did not answer in time. Try a smaller ring or fewer layers, or try again in a minute. Nothing was changed.', 502);
  }

  const skipped: Record<SkipReason, number> = { no_coords: 0, no_match: 0, unnamed: 0, outside_area: 0 };
  const mapped: CaptureCandidate[] = [];
  for (const el of elements) {
    const r = mapElement(el, matchers, input.area);
    if (typeof r === 'string') skipped[r]++;
    else mapped.push(r);
  }
  const candidates = dedupeCandidates(mapped).kept.map((c) => toPreview(c, 'osm'));

  const notes: string[] = [];
  if (elements.length >= MAX_ELEMENTS) notes.push(`OpenStreetMap returned the maximum of ${MAX_ELEMENTS} places — this area is dense. Capture it in smaller rings so nothing is cut off.`);
  const known = await markKnown(candidates);
  if (known) notes.push(known);
  const [s, w, n, e] = bboxOfArea(input.area);
  const bn = await boundaryNote((s + n) / 2, (w + e) / 2);
  if (bn) notes.push(bn);

  await audit({ actorId: actorId(user), action: 'poi.capture.preview', entity: 'admin_capture', entityId: null, meta: { km2: Number(km2.toFixed(2)), layers: input.layers, found: candidates.length, skipped } });
  return { candidates, skipped, notes, area: input.area, layers: input.layers, label: describeArea(input.area) };
}

/** Parse a Grid Navigator session file and return its places for the map. Writes NOTHING. */
export async function importNavigator(user: SessionUser, raw: unknown, fileName: string) {
  const parsed = parseNavigatorFile(raw);
  const s = parsed.stats;
  const candidates = parsed.candidates.map((c) => toPreview(c, 'file'));
  const notes = [
    `From ${cleanText(fileName, 80) || 'a Grid Navigator session'}: ${s.pois} places, ${s.checkpoints} checkpoints.`,
    s.skippedUnnamed ? `${s.skippedUnnamed} unnamed places skipped (BSA never invents a name).` : '',
    s.skippedInvalid ? `${s.skippedInvalid} rows skipped (invalid id or outside the Philippines).` : '',
    s.tilesIgnored ? `${s.tilesIgnored} cached map tiles ignored (not stored).` : '',
    s.checkpoints ? 'Checkpoints arrive as hand-placed pins — choose a category for each before saving.' : '',
  ].filter(Boolean);
  const known = await markKnown(candidates);
  if (known) notes.push(known);
  await audit({ actorId: actorId(user), action: 'poi.capture.import_preview', entity: 'admin_capture', entityId: null, meta: { ...s } });
  return { candidates, stats: s, notes, label: `Grid Navigator — ${cleanText(fileName, 60) || 'session'}` };
}

/* ------------------------------------------------------------------ save (the only write path) */

export interface SaveItem {
  osmRef?: string | null;
  receipt?: string | null;
  name: string;
  kind?: string | null;
  category: BsaPoiCategory;
  lat: number;
  lon: number;
  origin: 'osm' | 'file' | 'manual';
  notes?: string | null;
}
export interface SaveInput {
  source: 'osm' | 'navigator_import' | 'manual';
  label?: string;
  area?: CaptureArea;
  layers?: LayerKey[];
  context?: SiteContext;
  items: SaveItem[];
}

interface ResolvedItem {
  osmType: 'node' | 'way' | 'relation' | null;
  osmId: number | null;
  name: string;
  kind: string | null;
  category: BsaPoiCategory;
  lat: number;
  lon: number;
  verified: boolean;
  source: 'osm' | 'manual';
  notes: string | null;
}

/** Re-derive trust on the server: only an intact OSM receipt is Verified; everything else is Assumed. */
export function resolveSaveItems(items: SaveItem[]): ResolvedItem[] {
  const seen = new Set<string>();
  const out: ResolvedItem[] = [];
  for (const it of items) {
    const name = cleanText(it.name, MAX_NAME_LEN);
    if (!name) continue;
    const ref = it.osmRef ? parseOsmRef(it.osmRef) : null;
    const kind = it.kind ? cleanText(it.kind, 120) || null : null;
    const verified = !!ref && it.origin === 'osm' && verifyCandidate({ osmRef: it.osmRef!, name, kind, lat: it.lat, lon: it.lon }, it.receipt);
    const key = ref ? `${ref.osmType}/${ref.osmId}` : `m:${name.toLowerCase()}:${it.lat.toFixed(5)}:${it.lon.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      osmType: ref?.osmType ?? null, osmId: ref?.osmId ?? null, name, kind,
      category: it.category, lat: it.lat, lon: it.lon, verified,
      source: ref ? 'osm' : 'manual',
      notes: cleanText(it.notes ?? '', MAX_NOTES_LEN) || null,
    });
  }
  return out;
}

/**
 * Save reviewed places to BSA. Creates a committed batch (exact record of what was saved), writes
 * `poi` (verified OSM upserts; assumed rows never overwrite), tags PSGC, stamps Territory Guard's
 * coverage cells, and audits. Idempotent on the OSM key, so saving the same area twice is safe.
 */
export async function saveCapture(user: SessionUser, input: SaveInput) {
  const items = resolveSaveItems(input.items);
  if (!items.length) throw new CaptureError('nothing_to_save', 'There are no places to save.', 422);
  if (items.length > MAX_SAVE_ITEMS) throw new CaptureError('too_many', `Save at most ${MAX_SAVE_ITEMS.toLocaleString('en-US')} places at a time.`, 422);

  // 1) The batch record (committed straight away — there are no drafts in the database any more).
  const verifiedN = items.filter((i) => i.verified).length;
  const batch = await prisma.poiCaptureBatch.create({
    data: {
      label: cleanText(input.label ?? '', 120) || 'Capture',
      source: input.source,
      areaSpec: input.area ? ({ ...input.area, context: input.context ?? null } as unknown as Prisma.InputJsonValue) : undefined,
      layers: input.layers ?? [],
      status: 'committed',
      itemCount: items.length,
      notes: verifiedN < items.length ? `${items.length - verifiedN} place(s) saved as Assumed (edited, imported or hand-placed).` : null,
      createdById: actorId(user),
      committedById: actorId(user),
      committedAt: new Date(),
    },
    select: { id: true },
  });
  const batchId = batch.id;
  if (input.area) {
    const gj = JSON.stringify(areaGeoJson(input.area));
    await prisma.$executeRaw`UPDATE poi_capture_batch SET area = ST_SetSRID(ST_GeomFromGeoJSON(${gj}), 4326)::geography WHERE id = ${batchId}::uuid`;
  }

  // 2) Places. Verified OSM refreshes a stored element; Assumed keyed rows only add new elements.
  const keyed = items.filter((i) => i.osmType && i.osmId != null);
  const manual = items.filter((i) => !i.osmType || i.osmId == null);
  const CHUNK = 300;
  let written = 0;
  for (const [verified, group] of [[true, keyed.filter((i) => i.verified)], [false, keyed.filter((i) => !i.verified)]] as const) {
    for (let i = 0; i < group.length; i += CHUNK) {
      const chunk = group.slice(i, i + CHUNK);
      if (verified) await prisma.$executeRaw(claimLegacyOsmSql(chunk.map((c) => ({ osmType: c.osmType!, osmId: c.osmId!, lat: c.lat, lon: c.lon }))));
      const prov = `${input.source === 'navigator_import' ? 'osm:navigator-import' : 'osm:admin-capture'}:${batchId}`;
      const values = Prisma.join(chunk.map((c) => Prisma.sql`(
        ${c.name}, ${c.category}::"PoiCategory", ${c.lat}, ${c.lon}, ${regionForPoint(c.lat, c.lon)},
        'osm'::"PoiSource", ${prov}, ${verified ? 'verified' : 'assumed'}::"TruthLayer", ${c.osmId}, ${c.osmType}, ${c.kind}, ${batchId}::uuid)`));
      const onConflict = verified
        ? Prisma.sql`ON CONFLICT (osm_type, osm_id) DO UPDATE SET
            name = EXCLUDED.name, category = EXCLUDED.category, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
            kind = EXCLUDED.kind, source = EXCLUDED.source, provenance = EXCLUDED.provenance,
            truth_layer = EXCLUDED.truth_layer, capture_batch_id = EXCLUDED.capture_batch_id,
            region = COALESCE(poi.region, EXCLUDED.region)`
        : Prisma.sql`ON CONFLICT DO NOTHING`;
      written += await prisma.$executeRaw(Prisma.sql`
        INSERT INTO poi (name, category, lat, lon, region, source, provenance, truth_layer, osm_id, osm_type, kind, capture_batch_id)
        VALUES ${values}
        ${onConflict}`);
    }
  }
  for (const m of manual) {
    written += await prisma.$executeRaw`
      INSERT INTO poi (name, category, lat, lon, region, source, provenance, truth_layer, capture_batch_id)
      VALUES (${m.name}, ${m.category}::"PoiCategory", ${m.lat}, ${m.lon}, ${regionForPoint(m.lat, m.lon)},
              'manual'::"PoiSource", ${`manual:admin-capture:${batchId}`}, 'assumed'::"TruthLayer", ${batchId}::uuid)`;
  }

  // 3) Audit trail of exactly what was saved (one row per place).
  for (let i = 0; i < items.length; i += 500) {
    await prisma.poiCaptureItem.createMany({
      data: items.slice(i, i + 500).map((c) => ({
        batchId, osmType: c.osmType, osmId: c.osmId != null ? BigInt(c.osmId) : null, name: c.name, kind: c.kind,
        category: c.category, lat: c.lat, lon: c.lon, source: c.source, truthLayer: c.verified ? 'verified' : 'assumed',
        decision: 'accept', notes: c.notes,
      })),
    });
  }
  await prisma.$executeRaw`
    UPDATE poi_capture_item i SET committed_poi_id = p.id
    FROM poi p
    WHERE i.batch_id = ${batchId}::uuid AND i.osm_id IS NOT NULL AND p.osm_type = i.osm_type AND p.osm_id = i.osm_id`;
  await prisma.$executeRaw`
    UPDATE poi_capture_item i SET committed_poi_id = p.id
    FROM poi p
    WHERE i.batch_id = ${batchId}::uuid AND i.osm_id IS NULL AND p.capture_batch_id = ${batchId}::uuid
      AND p.osm_id IS NULL AND p.name = i.name AND p.lat = i.lat AND p.lon = i.lon`;

  // 4) PSGC tags for every place this batch wrote.
  const psgcTagged = await prisma.$executeRaw`
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

  // 5) Territory Guard coverage + batch totals + audit.
  const coverageStamped = input.source === 'osm' && input.area ? await stampCoverage(input.area, input.layers ?? []) : 0;
  const linked = await prisma.poiCaptureItem.count({ where: { batchId, committedPoiId: { not: null } } });
  await prisma.poiCaptureBatch.update({ where: { id: batchId }, data: { committedCount: linked } });
  const skippedExisting = items.length - written;
  await audit({ actorId: actorId(user), action: 'poi.capture.save', entity: 'poi_capture_batch', entityId: batchId, meta: { items: items.length, written, verified: verifiedN, psgcTagged, skippedExisting, coverageStamped } });
  return { batchId, saved: written, inBsa: linked, psgcTagged, skippedExisting, coverageStamped };
}

/**
 * Tell Territory Guard's on-demand cache that a captured area is covered for the captured
 * competitor verticals: every ~1.1 km coverage cell whose centre lies inside the capture area gets
 * a fresh `poi_coverage` stamp (source 'admin_capture'), using the same cell keys the cache reads.
 */
async function stampCoverage(area: CaptureArea, layers: string[]): Promise<number> {
  const verticals = layers.filter((l) => l.startsWith('v:')).map((l) => l.slice(2)).filter((v) => OSM_SELECTORS[v]);
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

/* ------------------------------------------------------------------ read-only views */

export async function listBatches(limit = 30) {
  const rows = await prisma.poiCaptureBatch.findMany({
    where: { status: 'committed' },
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, limit)),
    select: { id: true, label: true, source: true, status: true, itemCount: true, committedCount: true, layers: true, createdAt: true, committedAt: true, createdBy: { select: { email: true } } },
  });
  return rows.map((r) => ({ ...r, createdBy: r.createdBy?.email ?? null }));
}

/** A saved batch and the places it saved (for viewing on the map). */
export async function getBatch(batchId: string) {
  const batch = await prisma.poiCaptureBatch.findUnique({
    where: { id: batchId },
    select: { id: true, label: true, source: true, status: true, itemCount: true, committedCount: true, layers: true, areaSpec: true, notes: true, createdAt: true, committedAt: true, createdBy: { select: { email: true } } },
  });
  if (!batch) return null;
  const items = await prisma.poiCaptureItem.findMany({ where: { batchId, decision: 'accept' }, orderBy: { name: 'asc' }, take: 5_000 });
  return {
    batch: { ...batch, createdBy: batch.createdBy?.email ?? null },
    items: items.map((it) => ({
      key: it.osmType && it.osmId != null ? `${it.osmType}/${it.osmId}` : `saved:${it.id}`,
      osmRef: it.osmType && it.osmId != null ? `${it.osmType}/${it.osmId}` : null,
      name: it.name, kind: it.kind, category: it.category, lat: it.lat, lon: it.lon,
      truthLayer: it.truthLayer, committedPoiId: it.committedPoiId?.toString() ?? null, notes: it.notes,
    })),
  };
}

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

