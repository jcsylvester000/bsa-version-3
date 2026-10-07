/**
 * A staged place, already mapped to `poi` columns. Produced by the OSM area pull, the
 * grid-navigator file import and manual pins; reviewed by an admin; committed to `poi`.
 */
import type { BsaPoiCategory } from '@/lib/places/osmCategory';

export type OsmType = 'node' | 'way' | 'relation';
export type CaptureSource = 'osm' | 'manual';
export type TruthLayer = 'verified' | 'assumed' | 'projected';

export interface CaptureCandidate {
  osmType: OsmType | null;
  osmId: number | null;
  name: string;
  /** Matched OSM tag ("amenity=pharmacy"); null for manual pins. */
  kind: string | null;
  category: BsaPoiCategory;
  lat: number;
  lon: number;
  source: CaptureSource;
  truthLayer: TruthLayer;
  /** Reviewer must decide before commit (e.g. a manual pin with no category chosen yet). */
  needsReview?: boolean;
  notes?: string | null;
}

export const MAX_NAME_LEN = 200;
export const MAX_NOTES_LEN = 500;

export function cleanText(v: unknown, max: number): string {
  // Collapse whitespace and strip control characters (names are shown in the UI and reports).
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** "node/123" → { osmType, osmId }; null when the ref is not a valid OSM element reference. */
export function parseOsmRef(ref: unknown): { osmType: OsmType; osmId: number } | null {
  if (typeof ref !== 'string') return null;
  const m = /^(node|way|relation)\/(\d{1,15})$/.exec(ref.trim());
  if (!m) return null;
  const osmId = Number(m[2]);
  if (!Number.isSafeInteger(osmId) || osmId <= 0) return null;
  return { osmType: m[1] as OsmType, osmId };
}

export function osmRefKey(c: Pick<CaptureCandidate, 'osmType' | 'osmId'>): string | null {
  return c.osmType && c.osmId != null ? `${c.osmType}/${c.osmId}` : null;
}

/** In-batch de-duplication: OSM key first, else name + ~10 m rounded position. */
export function dedupeCandidates(list: CaptureCandidate[]): { kept: CaptureCandidate[]; dropped: number } {
  const seen = new Set<string>();
  const kept: CaptureCandidate[] = [];
  for (const c of list) {
    const k = osmRefKey(c) ?? `m:${c.name.toLowerCase()}:${c.lat.toFixed(4)}:${c.lon.toFixed(4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push(c);
  }
  return { kept, dropped: list.length - kept.length };
}
