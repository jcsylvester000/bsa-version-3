/**
 * grid-navigator session file (.gridnav.json) → capture candidates. Pure + unit-tested.
 *
 * grid-navigator stays the separate offline field tool; BSA only IMPORTS what agents collected.
 *  - POIs ("node/123" ids) become OSM-keyed candidates. The file is client-supplied, so they are
 *    Assumed (not Verified) — a later "Capture this area" from live OSM refreshes them to Verified
 *    through the same key. If the key already exists in BSA the import never overwrites it.
 *  - Checkpoints become manual pins (Assumed) that the admin must categorise before commit.
 *  - Routes, shapes, settings and cached map tiles are ignored (tiles are never stored).
 *  - Unnamed POIs (grid-navigator names them after their category, e.g. "Health") are dropped,
 *    except transport stops, which get a generic label.
 *  - The navigator's per-area `city` is discarded: BSA re-derives barangay/city/province per point
 *    from PSGC boundaries at commit.
 */
import { z } from 'zod';
import { captureCategory, transportLabel } from '@/lib/places/osmCategory';
import { cleanText, dedupeCandidates, parseOsmRef, MAX_NAME_LEN, MAX_NOTES_LEN, type CaptureCandidate } from './candidate';
import { PH_BOUNDS } from './area';

/** Upload cap for an import (bytes). A save with cached tiles is far bigger — export without tiles. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
/** Most candidates one import may stage. */
export const MAX_IMPORT_ITEMS = 5_000;

/** grid-navigator's category display names — used as the name of UNNAMED places. */
const NAVIGATOR_PLACEHOLDER_NAMES = new Set(['emergency', 'health', 'fuel', 'bank / atm', 'civic', 'transit', 'essentials']);

const num = z.number().finite();
const PoiRow = z.object({ id: z.string().max(40), name: z.string().max(500).optional(), kind: z.string().max(80).optional(), lat: num, lng: num }).passthrough();
const CheckpointRow = z.object({ name: z.string().max(500).optional(), notes: z.string().max(5_000).optional(), lat: num, lng: num }).passthrough();
const SaveFileShape = z.object({
  format: z.literal('grid-navigator-save').optional(),
  version: z.number().optional(),
  checkpoints: z.array(z.unknown()),
  routes: z.array(z.unknown()),
  pois: z.array(z.unknown()).optional(),
  tiles: z.record(z.unknown()).optional(),
}).passthrough();

export interface NavigatorImport {
  candidates: CaptureCandidate[];
  stats: {
    pois: number;
    checkpoints: number;
    skippedUnnamed: number;
    skippedInvalid: number;
    duplicatesInFile: number;
    tilesIgnored: number;
    routesIgnored: number;
  };
}

export class NavigatorFileError extends Error {}

function inPh(lat: number, lon: number): boolean {
  return lat >= PH_BOUNDS.south && lat <= PH_BOUNDS.north && lon >= PH_BOUNDS.west && lon <= PH_BOUNDS.east;
}

/** Parse + convert. Throws NavigatorFileError with a user-safe message on an unrecognised file. */
export function parseNavigatorFile(raw: unknown): NavigatorImport {
  const top = SaveFileShape.safeParse(raw);
  if (!top.success) throw new NavigatorFileError('This file does not look like a Grid Navigator session (.gridnav.json).');
  const data = top.data;
  const stats: NavigatorImport['stats'] = {
    pois: 0, checkpoints: 0, skippedUnnamed: 0, skippedInvalid: 0, duplicatesInFile: 0,
    tilesIgnored: data.tiles ? Object.keys(data.tiles).length : 0,
    routesIgnored: data.routes.length,
  };
  const out: CaptureCandidate[] = [];

  for (const r of data.pois ?? []) {
    const p = PoiRow.safeParse(r);
    const ref = p.success ? parseOsmRef(p.data.id) : null;
    if (!p.success || !ref || !inPh(p.data.lat, p.data.lng)) { stats.skippedInvalid++; continue; }
    const kind = cleanText(p.data.kind ?? '', 80) || null;
    if (kind && !/^[a-z_:]+=[a-z0-9_ ]+$/i.test(kind)) { stats.skippedInvalid++; continue; }
    const category = captureCategory(kind);
    let name = cleanText(p.data.name ?? '', MAX_NAME_LEN);
    if (!name || NAVIGATOR_PLACEHOLDER_NAMES.has(name.toLowerCase())) {
      if (category !== 'transport') { stats.skippedUnnamed++; continue; }
      name = transportLabel(kind);
    }
    out.push({ ...ref, name, kind, category, lat: p.data.lat, lon: p.data.lng, source: 'osm', truthLayer: 'assumed' });
    stats.pois++;
  }

  for (const r of data.checkpoints) {
    const c = CheckpointRow.safeParse(r);
    if (!c.success || !inPh(c.data.lat, c.data.lng)) { stats.skippedInvalid++; continue; }
    const name = cleanText(c.data.name ?? '', MAX_NAME_LEN);
    if (!name) { stats.skippedUnnamed++; continue; }
    out.push({
      osmType: null, osmId: null, name, kind: null, category: 'other',
      lat: c.data.lat, lon: c.data.lng, source: 'manual', truthLayer: 'assumed',
      needsReview: true, notes: cleanText(c.data.notes ?? '', MAX_NOTES_LEN) || null,
    });
    stats.checkpoints++;
  }

  const { kept, dropped } = dedupeCandidates(out);
  stats.duplicatesInFile = dropped;
  if (kept.length > MAX_IMPORT_ITEMS) {
    throw new NavigatorFileError(`This file has ${kept.length.toLocaleString('en-US')} places; the limit per import is ${MAX_IMPORT_ITEMS.toLocaleString('en-US')}. Split the session and import in parts.`);
  }
  return { candidates: kept, stats };
}
