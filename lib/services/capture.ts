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
 * places, Grid Navigator imports and manual pins = Assumed. Places BSA already holds are never saved
 * again — the map shows them from the database and only NEW places are written.
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
import { catchmentFor, conceptForSite, summariseForTerritory, tierAcross, tierOfPlace, DEFAULT_SCAN_M, MAX_CAPTURE_VERTICALS } from '@/lib/capture/territoryAlign';
import { checkAreaPolicy, FRESH_DAYS } from '@/lib/capture/capturePolicy';
import { haversineMeters } from '@/lib/geo/geo';
import { cellsForArea, coverageCellKey } from '@/lib/places/poiCache';

/** Max elements one area pull returns (Overpass `out center N`). Hitting it = area too dense. */
const MAX_ELEMENTS = 5_000;
/** Time budget for the live Overpass call — keeps the request under the hosting function timeout. */
const PREVIEW_BUDGET_MS = 20_000;
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

export interface SiteContext { site?: { lat: number; lon: number }; vertical?: string; verticals?: string[]; brand?: string; format?: string }
export interface PreviewInput {
  area: CaptureArea; layers: LayerKey[]; withStored?: boolean; refresh?: boolean;
  /** Shown in the retry queue if a layer fails (e.g. "QSR / Fast food · Brgy San Juan I · Noveleta"). */
  label?: string;
  /** Site pin / business types, so a retry from the queue restores the same setup. */
  context?: SiteContext;
  /** Server-internal (automated back-fill): Overpass time budget for this call. Never from the API body. */
  budgetMs?: number;
}

/** poi_coverage key for a capture layer: verticals use Territory Guard's own key; others are namespaced. */
export function coverageKeyForLayer(layer: string): string {
  return layer.startsWith('v:') ? layer.slice(2) : `layer:${layer}`;
}

/** Coverage cells (~1.1 km) whose centre lies inside the area; the centre cell for very small areas. */
function cellsInside(area: CaptureArea): Array<{ key: string; lat: number; lon: number }> {
  const [s, w, n, e] = bboxOfArea(area);
  const cLat = (s + n) / 2, cLon = (w + e) / 2;
  const radius = haversineMeters({ lat: cLat, lon: cLon }, { lat: n, lon: e });
  const inside = cellsForArea(cLat, cLon, radius).filter((c) => containsPoint(area, c.lat, c.lon));
  if (inside.length) return inside.map((c) => ({ ...c, key: coverageCellKey(c.lat, c.lon) }));
  const lat = Math.round(cLat * 100) / 100, lon = Math.round(cLon * 100) / 100;
  return [{ key: coverageCellKey(lat, lon), lat, lon }];
}

const COVERAGE_FRESH_MS = FRESH_DAYS * 24 * 3600 * 1000;

/** True when every cell of the area was already captured for this layer within 90 days. */
async function layerCovered(area: CaptureArea, layer: string): Promise<boolean> {
  try {
    const cells = cellsInside(area);
    const fresh = await prisma.poiCoverage.count({
      where: { vertical: coverageKeyForLayer(layer), cellKey: { in: cells.map((c) => c.key) }, fetchedAt: { gte: new Date(Date.now() - COVERAGE_FRESH_MS) } },
    });
    return fresh >= cells.length;
  } catch {
    return false;
  }
}

/** A place already stored in BSA inside the area (drawn on the map, never re-saved). */
export interface StoredPlace { id: string; name: string; category: string; lat: number; lon: number; source: string; truthLayer: string; osmRef: string | null; barangay: string | null; city: string | null }

export async function storedInArea(area: CaptureArea, limit = 4_000): Promise<StoredPlace[]> {
  const [s, w, n, e] = bboxOfArea(area);
  const rows = await prisma.$queryRaw<Array<{ id: bigint; name: string; category: string; lat: number; lon: number; source: string; truth_layer: string; osm_type: string | null; osm_id: bigint | null; barangay: string | null; city: string | null }>>`
    SELECT id, name, category::text AS category, lat, lon, source::text AS source, truth_layer::text AS truth_layer, osm_type, osm_id, barangay, city
    FROM poi
    WHERE geom && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography
    LIMIT ${limit}`;
  return rows
    .filter((r) => containsPoint(area, r.lat, r.lon))
    .map((r) => ({
      id: r.id.toString(), name: r.name, category: r.category, lat: r.lat, lon: r.lon, source: r.source, truthLayer: r.truth_layer,
      osmRef: r.osm_type && r.osm_id != null ? `${r.osm_type}/${r.osm_id}` : null, barangay: r.barangay, city: r.city,
    }));
}

export interface LayerResult {
  layer: string; status: 'loaded' | 'covered' | 'failed'; found: number; newCount: number; inBsa: number; message?: string;
  /** Loaded, but OpenStreetMap returned the place limit — the layer is incomplete (logged for retry, never stamped). */
  truncated?: boolean;
}

/**
 * Load places for an area onto the map. READ-ONLY. Places BSA already holds come from the
 * database (`stored`, when withStored); OpenStreetMap is called only for layers this area has not
 * been captured for in the last 90 days (or when `refresh`), and only NEW places are returned as
 * candidates — anything already stored is counted, drawn from the DB, and never sent again.
 */
export async function previewArea(user: SessionUser, input: PreviewInput) {
  const km2 = areaKm2(input.area);
  if (km2 > MAX_CAPTURE_KM2) {
    throw new CaptureError('area_too_large', `This area is about ${km2.toFixed(1)} km². One capture can cover up to ${MAX_CAPTURE_KM2} km² — make the ring smaller, or use the province sweep (npm run db:ingest:osm) for whole regions.`, 422);
  }
  // Playbook: ≤ 1,000 m rings in dense centres, ≤ 1,500 m elsewhere — bigger rings come back incomplete.
  const pol = checkAreaPolicy(input.area);
  if (!pol.ok) throw new CaptureError('ring_too_large', pol.message, 422);
  const notes: string[] = [];
  let stored: StoredPlace[] | undefined;
  if (input.withStored) {
    try { stored = await storedInArea(input.area); }
    catch (e) { console.error('[capture] stored read failed', e); notes.push('Could not read the places BSA already holds here (database unreachable).'); }
    const [s, w, n, e] = bboxOfArea(input.area);
    const bn = await boundaryNote((s + n) / 2, (w + e) / 2);
    if (bn) notes.push(bn);
  }

  const results: LayerResult[] = [];
  const candidates: PreviewCandidate[] = [];
  for (const layer of input.layers) {
    if (!input.refresh && await layerCovered(input.area, layer)) {
      results.push({ layer, status: 'covered', found: 0, newCount: 0, inBsa: 0, message: 'Already captured here — showing saved places' });
      await resolveGapsByKey(areaKeyOf(input.area), layer);
      continue;
    }
    const { selectors, matchers } = selectorsForLayers([layer]);
    if (!selectors.length) { results.push({ layer, status: 'failed', found: 0, newCount: 0, inBsa: 0, message: 'Unknown layer' }); continue; }
    let elements;
    try {
      elements = await captureElementsInBbox(selectors, bboxOfArea(input.area), { max: MAX_ELEMENTS, budgetMs: (input.budgetMs ?? PREVIEW_BUDGET_MS) / Math.max(1, input.layers.length) });
    } catch (e) {
      const timeout = /timeout|timed out|abort|did not answer|429|504|502/i.test(e instanceof Error ? e.message : String(e));
      const message = timeout ? 'OpenStreetMap did not answer in time' : 'OpenStreetMap returned an error';
      results.push({ layer, status: 'failed', found: 0, newCount: 0, inBsa: 0, message: `${message} — logged in the retry queue` });
      await recordGap(user, input, layer, timeout ? 'timeout' : 'error', message);
      continue;
    }
    const mapped: CaptureCandidate[] = [];
    for (const el of elements) {
      const r = mapElement(el, matchers, input.area);
      if (typeof r !== 'string') mapped.push(r);
    }
    const list = dedupeCandidates(mapped).kept.map((c) => toPreview(c, 'osm'));
    const known = await markKnown(list);
    if (known && !notes.includes(known)) notes.push(known);
    const fresh = list.filter((c) => !c.existingPoiId);
    candidates.push(...fresh);
    const truncated = elements.length >= MAX_ELEMENTS;
    if (truncated) await recordGap(user, input, layer, 'limit', `Hit the ${MAX_ELEMENTS.toLocaleString('en-US')}-place limit — capture this area in smaller rings`);
    results.push({
      layer, status: 'loaded', found: list.length, newCount: fresh.length, inBsa: list.length - fresh.length, truncated: truncated || undefined,
      message: truncated ? `Hit the ${MAX_ELEMENTS.toLocaleString('en-US')}-place limit — incomplete, logged for retry with smaller rings` : undefined,
    });
  }

  if (input.withStored) {
    await audit({ actorId: actorId(user), action: 'poi.capture.preview', entity: 'admin_capture', entityId: null, meta: { km2: Number(km2.toFixed(2)), layers: input.layers, results } });
  }
  return { layers: results, candidates: dedupeByKey(candidates), stored, notes };
}

function dedupeByKey(list: PreviewCandidate[]): PreviewCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.key) ? false : (seen.add(c.key), true)));
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
  const inBsa = candidates.filter((c) => c.existingPoiId).length;
  if (inBsa) notes.push(`${inBsa} of these places are already saved in BSA — they are shown but not saved again.`);
  await audit({ actorId: actorId(user), action: 'poi.capture.import_preview', entity: 'admin_capture', entityId: null, meta: { ...s } });
  return { candidates: candidates.filter((c) => !c.existingPoiId), alreadyInBsa: inBsa, stats: s, notes, label: `Grid Navigator — ${cleanText(fileName, 60) || 'session'}` };
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
  /** Layers that were actually loaded from OpenStreetMap for this area (stamped as covered on save). */
  fetchedLayers?: LayerKey[];
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
  // An area can be saved with no new places (everything was already in BSA): it still records the
  // capture and marks the area as covered so it is not fetched from OpenStreetMap again.
  if (!items.length && !(input.area && input.fetchedLayers?.length)) throw new CaptureError('nothing_to_save', 'There are no places to save.', 422);
  if (items.length > MAX_SAVE_ITEMS) throw new CaptureError('too_many', `Save at most ${MAX_SAVE_ITEMS.toLocaleString('en-US')} places at a time.`, 422);

  // 1) The batch record (committed straight away — there are no drafts in the database any more).
  const verifiedN = items.filter((i) => i.verified).length;
  const batch = await prisma.poiCaptureBatch.create({
    data: {
      label: cleanText(input.label ?? '', 120) || 'Capture',
      source: input.source,
      areaSpec: input.area ? ({ ...input.area, context: input.context ?? null } as unknown as Prisma.InputJsonValue) : undefined,
      layers: input.layers ?? [],
      fetchedLayers: input.source === 'osm' ? (input.fetchedLayers ?? []) : [],
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

  // 2) Places — NEW ONLY. A place BSA already holds is never written again (ON CONFLICT DO NOTHING);
  //    verified elements first claim a legacy typeless row so it is recognised instead of duplicated.
  const keyed = items.filter((i) => i.osmType && i.osmId != null);
  const manual = items.filter((i) => !i.osmType || i.osmId == null);
  const CHUNK = 300;
  let written = 0;
  const prov = `${input.source === 'navigator_import' ? 'osm:navigator-import' : 'osm:admin-capture'}:${batchId}`;
  for (let i = 0; i < keyed.length; i += CHUNK) {
    const chunk = keyed.slice(i, i + CHUNK);
    const verifiedChunk = chunk.filter((c) => c.verified);
    if (verifiedChunk.length) await prisma.$executeRaw(claimLegacyOsmSql(verifiedChunk.map((c) => ({ osmType: c.osmType!, osmId: c.osmId!, lat: c.lat, lon: c.lon }))));
    const values = Prisma.join(chunk.map((c) => Prisma.sql`(
      ${c.name}, ${c.category}::"PoiCategory", ${c.lat}, ${c.lon}, ${regionForPoint(c.lat, c.lon)},
      'osm'::"PoiSource", ${prov}, ${c.verified ? 'verified' : 'assumed'}::"TruthLayer", ${c.osmId}, ${c.osmType}, ${c.kind}, ${batchId}::uuid)`));
    written += await prisma.$executeRaw(Prisma.sql`
      INSERT INTO poi (name, category, lat, lon, region, source, provenance, truth_layer, osm_id, osm_type, kind, capture_batch_id)
      VALUES ${values}
      ON CONFLICT DO NOTHING`);
  }
  for (const m of manual) {
    written += await prisma.$executeRaw`
      INSERT INTO poi (name, category, lat, lon, region, source, provenance, truth_layer, capture_batch_id)
      VALUES (${m.name}, ${m.category}::"PoiCategory", ${m.lat}, ${m.lon}, ${regionForPoint(m.lat, m.lon)},
              'manual'::"PoiSource", ${`manual:admin-capture:${batchId}`}, 'assumed'::"TruthLayer", ${batchId}::uuid)`;
  }

  // 3) Audit trail of exactly what was saved (one row per place).
  //    Raw multi-row INSERT, not createMany: under the Neon HTTP adapter Prisma runs createMany inside
  //    an implicit transaction, which HTTP mode refuses ("Transactions are not supported in HTTP mode").
  for (let i = 0; i < items.length; i += 300) {
    const rows = Prisma.join(items.slice(i, i + 300).map((c) => Prisma.sql`(
      ${batchId}::uuid, ${c.osmType}, ${c.osmId != null ? String(c.osmId) : null}::bigint, ${c.name}, ${c.kind},
      ${c.category}::"PoiCategory", ${c.lat}, ${c.lon}, ${c.source}::"PoiSource", ${c.verified ? 'verified' : 'assumed'}::"TruthLayer",
      'accept'::"CaptureDecision", ${c.notes})`));
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO poi_capture_item (batch_id, osm_type, osm_id, name, kind, category, lat, lon, source, truth_layer, decision, notes)
      VALUES ${rows}`);
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
  const coverageStamped = input.source === 'osm' && input.area ? await stampCoverage(input.area, input.fetchedLayers ?? []) : 0;
  const gapsResolved = input.source === 'osm' && input.area && input.fetchedLayers?.length ? await resolveGapsForBatch(batchId, input.fetchedLayers) : 0;
  const linked = await prisma.poiCaptureItem.count({ where: { batchId, committedPoiId: { not: null } } });
  await prisma.poiCaptureBatch.update({ where: { id: batchId }, data: { committedCount: linked } });
  const alreadyInBsa = items.length - written;
  await audit({ actorId: actorId(user), action: 'poi.capture.save', entity: 'poi_capture_batch', entityId: batchId, meta: { items: items.length, written, verified: verifiedN, psgcTagged, alreadyInBsa, coverageStamped, gapsResolved } });
  return { batchId, saved: written, alreadyInBsa, linked, psgcTagged, coverageStamped, gapsResolved };
}

/**
 * Tell Territory Guard's on-demand cache that a captured area is covered for the captured
 * competitor verticals: every ~1.1 km coverage cell whose centre lies inside the capture area gets
 * a fresh `poi_coverage` stamp (source 'admin_capture'), using the same cell keys the cache reads.
 */
async function stampCoverage(area: CaptureArea, layers: string[]): Promise<number> {
  const keys = [...new Set(layers.filter((l) => !l.startsWith('v:') || OSM_SELECTORS[l.slice(2)]).map(coverageKeyForLayer))];
  if (!keys.length) return 0;
  const cells = cellsInside(area);
  let stamped = 0;
  for (const k of keys) {
    for (const c of cells) {
      await prisma.poiCoverage.upsert({
        where: { coverage_cell_vertical: { cellKey: c.key, vertical: k } },
        create: { cellKey: c.key, vertical: k, lat: c.lat, lon: c.lon, poiCount: 0, source: 'admin_capture' },
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
  // Open retry entries, drawn red on the capture map so the admin works gaps, not covered ground.
  let gaps: Array<{ id: string; layer: string; geojson: string | null }> = [];
  try {
    gaps = await prisma.$queryRaw`SELECT id::text, layer, ST_AsGeoJSON(area, 6)::text AS geojson FROM poi_capture_gap WHERE status = 'open' AND area IS NOT NULL LIMIT 500`;
  } catch { /* retry queue not migrated yet */ }
  const freshSince = Date.now() - COVERAGE_FRESH_MS;
  return {
    areas: areas.map((a) => ({
      id: a.id, label: a.label, committedCount: a.committed_count, committedAt: a.committed_at,
      fresh: !!a.committed_at && a.committed_at.getTime() >= freshSince,
      geometry: a.geojson ? JSON.parse(a.geojson) : null,
    })),
    gaps: gaps.map((g) => ({ id: g.id, layer: g.layer, geometry: g.geojson ? JSON.parse(g.geojson) : null })),
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

export interface ReadinessInput { lat: number; lon: number; radiusM?: number; format?: string; vertical?: string; verticals?: string[]; brand?: string }

/**
 * "What Territory Guard sees here right now" for a site pin — the same query, tiers, catchment
 * radii and saturation curve the module uses, per chosen business type, plus where the pin falls
 * (PSGC barangay / city / province) so the admin can confirm the coordinate before capturing.
 */
export async function siteReadiness(input: ReadinessInput) {
  const radiusM = Math.min(3_000, Math.max(200, input.radiusM ?? DEFAULT_SCAN_M));
  const catchmentM = catchmentFor(input.format);
  const verticals = [...new Set([...(input.verticals ?? []), ...(input.vertical ? [input.vertical] : [])])].slice(0, MAX_CAPTURE_VERTICALS);
  const concepts = verticals.map((v) => ({ vertical: v, concept: conceptForSite(v, input.brand) }));
  const boundary = await resolveAdminBoundary(input.lat, input.lon);
  const rows = await prisma.$queryRaw<Array<{ id: bigint; name: string; category: string; lat: number; lon: number; source: string; truth_layer: string }>>`
    SELECT id, name, category::text AS category, lat, lon, source::text AS source, truth_layer::text AS truth_layer
    FROM poi
    WHERE geom IS NOT NULL
      AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography, ${radiusM})
    ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography) ASC
    LIMIT 1500`;
  const base = rows.map((r) => ({
    id: r.id.toString(), name: r.name, category: r.category, lat: r.lat, lon: r.lon, source: r.source, truthLayer: r.truth_layer,
    distM: Math.round(haversineMeters({ lat: input.lat, lon: input.lon }, { lat: r.lat, lon: r.lon })),
  }));
  const byVertical = concepts.map(({ vertical, concept }) => ({
    vertical,
    concept: concept ? { key: concept.key, label: concept.label } : null,
    summary: summariseForTerritory(base.map((p) => ({ tier: tierOfPlace(p, concept), distM: p.distM })), catchmentM),
  }));
  const places = base.map((p) => ({ ...p, tier: tierAcross(p, concepts.map((c) => c.concept)) }));
  const cells = cellsForArea(input.lat, input.lon, radiusM);
  const keys = cells.map((c) => coverageCellKey(c.lat, c.lon));
  const coverage = await Promise.all(verticals.filter((v) => OSM_SELECTORS[v]).map(async (v) => ({
    vertical: v,
    cells: keys.length,
    fresh: await prisma.poiCoverage.count({ where: { vertical: v, cellKey: { in: keys }, fetchedAt: { gte: new Date(Date.now() - COVERAGE_FRESH_MS) } } }),
  })));
  const first = byVertical[0];
  return {
    site: { lat: input.lat, lon: input.lon },
    boundary,
    region: boundary?.region ?? regionForPoint(input.lat, input.lon),
    catchmentM,
    radiusM,
    byVertical,
    concept: first?.concept ?? null,
    summary: first?.summary ?? summariseForTerritory(places.map((p) => ({ tier: p.tier, distM: p.distM })), catchmentM),
    coverage,
    previousCaptures: await capturesAtPoint(input.lat, input.lon),
    places: places.slice(0, 600),
    capped: rows.length >= 1500,
  };
}

/* ------------------------------------------------------------------ capture log & retry queue */

/** Stable key for "the same area" (≈1 m rounding), so a repeated failure bumps one queue row. */
export function areaKeyOf(area: CaptureArea): string {
  const r = (v: number) => v.toFixed(5);
  return area.kind === 'circle' ? `c:${r(area.lat)}:${r(area.lon)}:${Math.round(area.radiusM)}` : `r:${r(area.south)}:${r(area.west)}:${r(area.north)}:${r(area.east)}`;
}

export type GapReason = 'timeout' | 'limit' | 'error';

/**
 * Log an area + layer that OpenStreetMap did not return completely. This is bookkeeping, not place
 * data — no `poi` row is touched — and it never fails the preview (a missing migration is ignored).
 */
async function recordGap(user: SessionUser, input: PreviewInput, layer: string, reason: GapReason, message: string): Promise<void> {
  try {
    const [s, w, n, e] = bboxOfArea(input.area);
    const lat = (s + n) / 2, lon = (w + e) / 2;
    const label = cleanText(input.label ?? '', 160) || describeArea(input.area);
    const spec = JSON.stringify(input.area);
    const ctx = input.context ? JSON.stringify(input.context) : null;
    const gj = JSON.stringify(areaGeoJson(input.area));
    await prisma.$executeRaw`
      INSERT INTO poi_capture_gap (area_key, layer, label, area_spec, context, area, lat, lon, reason, message, created_by)
      VALUES (${areaKeyOf(input.area)}, ${layer}, ${label}, ${spec}::jsonb, ${ctx}::jsonb,
              ST_SetSRID(ST_GeomFromGeoJSON(${gj}), 4326)::geography, ${lat}, ${lon}, ${reason}, ${message}, ${actorId(user)}::uuid)
      ON CONFLICT (area_key, layer) WHERE status = 'open'
      DO UPDATE SET attempts = poi_capture_gap.attempts + 1, last_attempt_at = now(), reason = EXCLUDED.reason, message = EXCLUDED.message`;
  } catch (e) {
    console.error('[capture] could not log the retry-queue entry', e);
  }
}

/** The exact area is already covered for this layer (captured since) → close its open entry. */
async function resolveGapsByKey(areaKey: string, layer: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE poi_capture_gap SET status = 'resolved', resolved_at = now()
      WHERE status = 'open' AND area_key = ${areaKey} AND layer = ${layer} AND reason <> 'limit'`;
  } catch { /* bookkeeping only */ }
}

/**
 * After a save: close every open entry, for a layer this capture loaded completely, whose area is now
 * fully covered by saved captures of that layer from the last 90 days (Territory Guard's freshness
 * window) — one big save or several smaller rings, the union counts. ~30 m tolerance for ring vertices.
 * Only `fetched_layers` count, so a failed or truncated layer never closes its own entry.
 */
async function resolveGapsForBatch(batchId: string, fetchedLayers: string[]): Promise<number> {
  try {
    return await prisma.$executeRaw(Prisma.sql`
      UPDATE poi_capture_gap g SET status = 'resolved', resolved_at = now(), resolved_batch_id = ${batchId}::uuid
      FROM poi_capture_batch nb
      WHERE nb.id = ${batchId}::uuid AND nb.area IS NOT NULL
        AND g.status = 'open' AND g.area IS NOT NULL
        AND g.layer IN (${Prisma.join(fetchedLayers)})
        AND ST_Intersects(nb.area::geometry, g.area::geometry)
        AND ST_Covers(
          ST_Buffer((
            SELECT ST_Union(b.area::geometry) FROM poi_capture_batch b
            WHERE b.status = 'committed' AND b.area IS NOT NULL AND g.layer = ANY(b.fetched_layers)
              AND b.created_at >= now() - interval '90 days' AND ST_Intersects(b.area::geometry, g.area::geometry)
          ), 0.0003),
          g.area::geometry)`);
  } catch (e) {
    console.error('[capture] could not resolve retry-queue entries', e);
    return 0;
  }
}

export interface CaptureLogArea {
  id: string; label: string; source: string; layers: string[]; fetchedLayers: string[];
  itemCount: number; savedCount: number; createdAt: Date; createdBy: string | null;
  lat: number; lon: number; km2: number;
  barangay: string | null; city: string | null; province: string | null; region: string | null;
  geometry: GeoJSON.Geometry | null;
}
export interface CaptureGapRow {
  id: string; layer: string; label: string; reason: GapReason; message: string | null; attempts: number;
  status: 'open' | 'resolved' | 'dismissed'; createdAt: Date; lastAttemptAt: Date; resolvedAt: Date | null; createdBy: string | null;
  lat: number; lon: number; areaSpec: CaptureArea; context: SiteContext | null;
  barangay: string | null; city: string | null; province: string | null; region: string | null;
  geometry: GeoJSON.Geometry | null;
}

/** Barangay / city / province / region of a point, from the loaded PSGC boundaries (SQL fragment). */
const placeOfPoint = (lonSql: Prisma.Sql, latSql: Prisma.Sql) => Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT bg.name AS barangay, c.name AS city, pr.name AS province, bg.region AS region
    FROM admin_boundary bg
    LEFT JOIN admin_boundary c  ON c.psgc_code  = bg.parent_psgc
    LEFT JOIN admin_boundary pr ON pr.psgc_code = c.parent_psgc
    WHERE bg.level = 'barangay' AND bg.geom IS NOT NULL
      AND ST_Intersects(bg.geom, ST_SetSRID(ST_MakePoint(${lonSql}, ${latSql}), 4326)::geography)
    LIMIT 1
  ) loc ON true`;

/**
 * The capture log: every saved capture area (where, when, who, what was loaded, how many places
 * were new) plus the retry queue, for the admin Coverage screen. Read-only.
 */
export async function captureLog(opts: { days?: number; limit?: number } = {}) {
  const since = opts.days ? new Date(Date.now() - opts.days * 86_400_000) : new Date(0);
  const limit = Math.min(2_000, Math.max(1, opts.limit ?? 1_000));
  const areas = await prisma.$queryRaw<Array<{
    id: string; label: string; source: string; layers: string[]; fetched_layers: string[]; item_count: number; committed_count: number;
    created_at: Date; email: string | null; lat: number; lon: number; km2: number; geojson: string | null;
    barangay: string | null; city: string | null; province: string | null; region: string | null;
  }>>(Prisma.sql`
    SELECT b.id::text, b.label, b.source, b.layers, b.fetched_layers, b.item_count, b.committed_count, b.created_at, u.email,
           ST_Y(ST_Centroid(b.area::geometry)) AS lat, ST_X(ST_Centroid(b.area::geometry)) AS lon,
           (ST_Area(b.area) / 1e6)::float8 AS km2, ST_AsGeoJSON(b.area, 6)::text AS geojson,
           loc.barangay, loc.city, loc.province, loc.region
    FROM poi_capture_batch b
    LEFT JOIN app_user u ON u.id = b.created_by
    ${placeOfPoint(Prisma.sql`ST_X(ST_Centroid(b.area::geometry))`, Prisma.sql`ST_Y(ST_Centroid(b.area::geometry))`)}
    WHERE b.status = 'committed' AND b.area IS NOT NULL AND b.created_at >= ${since}
    ORDER BY b.created_at DESC
    LIMIT ${limit}`);
  const gaps = await listGaps({ status: 'all', limit: 500 });
  const totals = await prisma.$queryRaw<Array<{ batches: number; places: number; areas_km2: number; last_at: Date | null }>>`
    SELECT COUNT(*)::int AS batches, COALESCE(SUM(committed_count), 0)::int AS places,
           COALESCE((ST_Area(ST_Union(area::geometry)::geography) / 1e6), 0)::float8 AS areas_km2, MAX(created_at) AS last_at
    FROM poi_capture_batch WHERE status = 'committed'`;
  const regions = await prisma.$queryRaw<Array<{ region: string | null; total: number; tagged: number }>>`
    SELECT region, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE psgc_code IS NOT NULL)::int AS tagged
    FROM poi GROUP BY region ORDER BY total DESC`;
  const boundaries = await prisma.$queryRaw<Array<{ region: string | null; barangays: number }>>`
    SELECT region, COUNT(*)::int AS barangays FROM admin_boundary
    WHERE level = 'barangay' AND geom IS NOT NULL GROUP BY region`;
  const layersSeen = await prisma.$queryRaw<Array<{ vertical: string; cells: number }>>`
    SELECT vertical, COUNT(*)::int AS cells FROM poi_coverage GROUP BY vertical ORDER BY cells DESC LIMIT 80`;
  return {
    totals: { ...totals[0], openGaps: gaps.filter((g) => g.status === 'open').length },
    areas: areas.map((a): CaptureLogArea => ({
      id: a.id, label: a.label, source: a.source, layers: a.layers, fetchedLayers: a.fetched_layers, itemCount: a.item_count, savedCount: a.committed_count,
      createdAt: a.created_at, createdBy: a.email, lat: a.lat, lon: a.lon, km2: Number(a.km2.toFixed(2)),
      barangay: a.barangay, city: a.city, province: a.province, region: a.region ?? regionForPoint(a.lat, a.lon),
      geometry: a.geojson ? JSON.parse(a.geojson) : null,
    })),
    gaps,
    regions,
    boundaries,
    coverageKeys: layersSeen,
  };
}

/** The retry queue (open by default), newest attempt first. */
export async function listGaps(opts: { status?: 'open' | 'resolved' | 'dismissed' | 'all'; limit?: number } = {}): Promise<CaptureGapRow[]> {
  const status = opts.status ?? 'open';
  const where = status === 'all' ? Prisma.sql`TRUE` : Prisma.sql`g.status = ${status}::"CaptureGapStatus"`;
  const rows = await prisma.$queryRaw<Array<{
    id: string; layer: string; label: string; reason: GapReason; message: string | null; attempts: number; status: CaptureGapRow['status'];
    created_at: Date; last_attempt_at: Date; resolved_at: Date | null; email: string | null; lat: number; lon: number;
    area_spec: string; context: string | null; geojson: string | null; barangay: string | null; city: string | null; province: string | null; region: string | null;
  }>>(Prisma.sql`
    SELECT g.id::text, g.layer, g.label, g.reason, g.message, g.attempts, g.status::text AS status, g.created_at, g.last_attempt_at, g.resolved_at,
           u.email, g.lat, g.lon, g.area_spec::text AS area_spec, g.context::text AS context, ST_AsGeoJSON(g.area, 6)::text AS geojson,
           loc.barangay, loc.city, loc.province, loc.region
    FROM poi_capture_gap g
    LEFT JOIN app_user u ON u.id = g.created_by
    ${placeOfPoint(Prisma.sql`g.lon`, Prisma.sql`g.lat`)}
    WHERE ${where}
    ORDER BY (g.status = 'open') DESC, g.last_attempt_at DESC
    LIMIT ${Math.min(1_000, Math.max(1, opts.limit ?? 300))}`);
  return rows.map((r) => ({
    id: r.id, layer: r.layer, label: r.label, reason: r.reason, message: r.message, attempts: r.attempts, status: r.status,
    createdAt: r.created_at, lastAttemptAt: r.last_attempt_at, resolvedAt: r.resolved_at, createdBy: r.email, lat: r.lat, lon: r.lon,
    areaSpec: JSON.parse(r.area_spec) as CaptureArea, context: r.context ? (JSON.parse(r.context) as SiteContext) : null,
    barangay: r.barangay, city: r.city, province: r.province, region: r.region ?? regionForPoint(r.lat, r.lon),
    geometry: r.geojson ? JSON.parse(r.geojson) : null,
  }));
}

export async function getGap(id: string): Promise<CaptureGapRow | null> {
  if (!isUuid(id)) return null;
  const rows = await listGaps({ status: 'all', limit: 1_000 });
  return rows.find((g) => g.id === id) ?? null;
}

/** Dismiss (nothing to capture there) or re-open a queue entry. Admin-only (route), audit-logged. */
export async function setGapStatus(user: SessionUser, id: string, action: 'dismiss' | 'reopen') {
  if (!isUuid(id)) throw new CaptureError('not_found', 'Retry entry not found.', 404);
  const n = action === 'dismiss'
    ? await prisma.$executeRaw`UPDATE poi_capture_gap SET status = 'dismissed', resolved_at = now() WHERE id = ${id}::uuid AND status = 'open'`
    : await prisma.$executeRaw`
        UPDATE poi_capture_gap g SET status = 'open', resolved_at = NULL, resolved_batch_id = NULL
        WHERE g.id = ${id}::uuid AND g.status = 'dismissed'
          AND NOT EXISTS (SELECT 1 FROM poi_capture_gap o WHERE o.status = 'open' AND o.area_key = g.area_key AND o.layer = g.layer)`;
  if (!n) throw new CaptureError('conflict', action === 'dismiss' ? 'Only open entries can be dismissed.' : 'Only dismissed entries can be re-opened (and not when the same area is already open).', 409);
  await audit({ actorId: actorId(user), action: `poi.capture.gap.${action}`, entity: 'poi_capture_gap', entityId: id, meta: {} });
  return { id, status: action === 'dismiss' ? 'dismissed' : 'open' };
}

/** Territory Guard coverage cells (~1.1 km) in a bbox for one coverage key — freshness map. Read-only. */
export async function coverageCells(bbox: [number, number, number, number], vertical: string, limit = 6_000) {
  const [s, w, n, e] = bbox;
  const rows = await prisma.poiCoverage.findMany({
    where: { vertical, lat: { gte: s - 0.01, lte: n + 0.01 }, lon: { gte: w - 0.01, lte: e + 0.01 } },
    select: { cellKey: true, lat: true, lon: true, poiCount: true, fetchedAt: true, source: true },
    take: limit,
  });
  return rows.map((r) => {
    const [la, lo] = r.cellKey.split(':').map(Number);
    return { key: r.cellKey, lat: Number.isFinite(la) ? la : r.lat, lon: Number.isFinite(lo) ? lo : r.lon, poiCount: r.poiCount, fetchedAt: r.fetchedAt, source: r.source };
  });
}

/** Saved captures whose area contains a point — "this spot was captured before" on the capture screen. */
export async function capturesAtPoint(lat: number, lon: number, limit = 5) {
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; label: string; created_at: Date; fetched_layers: string[]; layers: string[]; committed_count: number }>>`
      SELECT id::text, label, created_at, fetched_layers, layers, committed_count
      FROM poi_capture_batch
      WHERE status = 'committed' AND area IS NOT NULL
        AND ST_Covers(area, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography)
      ORDER BY created_at DESC LIMIT ${limit}`;
    return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at, layers: r.fetched_layers.length ? r.fetched_layers : r.layers, savedCount: r.committed_count }));
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ capture plan (pre-flight) */

/** Per layer: how many of the area's coverage cells were captured in the last 90 days. Read-only. */
export async function layerFreshness(area: CaptureArea, layerKeys: string[]): Promise<CapturePlanLayer[]> {
  const cells = cellsInside(area);
  const keys = cells.map((c) => c.key);
  const since = new Date(Date.now() - COVERAGE_FRESH_MS);
  const out: CapturePlanLayer[] = [];
  for (const layer of layerKeys) {
    const rows = await prisma.poiCoverage.findMany({
      where: { vertical: coverageKeyForLayer(layer), cellKey: { in: keys } },
      select: { fetchedAt: true },
    });
    const fresh = rows.filter((r) => r.fetchedAt >= since).length;
    const last = rows.reduce<Date | null>((m, r) => (!m || r.fetchedAt > m ? r.fetchedAt : m), null);
    out.push({ layer, covered: fresh >= cells.length, cells: cells.length, freshCells: fresh, lastCapturedAt: last });
  }
  return out;
}

export interface CapturePlanLayer { layer: string; covered: boolean; cells: number; freshCells: number; lastCapturedAt: Date | null }

/**
 * The pre-flight check the screen shows before anything is fetched — the playbook applied to one area:
 * which layers are already captured (and will be skipped), open retry entries inside the area, the ring
 * rule for this spot, whether barangay boundaries are loaded, and earlier captures here. Read-only.
 */
export async function planCapture(input: { area: CaptureArea; layers: LayerKey[] }) {
  const [s, w, n, e] = bboxOfArea(input.area);
  const lat = (s + n) / 2, lon = (w + e) / 2;
  const layers = await layerFreshness(input.area, input.layers);
  const gj = JSON.stringify(areaGeoJson(input.area));
  let openGaps: Array<{ id: string; layer: string; reason: string; label: string; attempts: number }> = [];
  try {
    openGaps = await prisma.$queryRaw`
      SELECT id::text, layer, reason, label, attempts FROM poi_capture_gap
      WHERE status = 'open' AND area IS NOT NULL
        AND ST_Intersects(area::geometry, ST_SetSRID(ST_GeomFromGeoJSON(${gj}), 4326))
      ORDER BY last_attempt_at DESC LIMIT 20`;
  } catch { /* retry queue not migrated yet */ }
  const boundary = await resolveAdminBoundary(lat, lon);
  const storedCount = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM poi WHERE geom && ST_MakeEnvelope(${w}, ${s}, ${e}, ${n}, 4326)::geography`;
  const km2 = areaKm2(input.area);
  const density = km2 > 0 ? (storedCount[0]?.n ?? 0) / km2 : 0;
  const policy = checkAreaPolicy(input.area, density);
  return {
    layers,
    toFetch: layers.filter((l) => !l.covered).map((l) => l.layer),
    openGaps,
    ring: { ok: policy.ok, message: policy.ok ? null : policy.message, ...policy.policy },
    storedPlaces: storedCount[0]?.n ?? 0,
    boundary: boundary ? { barangay: boundary.barangay, city: boundary.city, province: boundary.province } : null,
    previousCaptures: await capturesAtPoint(lat, lon),
  };
}
