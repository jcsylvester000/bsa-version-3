/**
 * Territory Guard alignment for Place Capture (pure, client + server).
 *
 * Territory Guard reads `poi` rows with category 'competitor' around a site, sorts them into
 * direct / adjacent / unrelated by NAME for the site's concept (tierFor), counts the ones inside
 * the format's catchment ring, and turns the weighted count into the Projected saturation %.
 * Place Capture uses exactly those rules, so what an admin sees before saving is what Territory
 * Guard will see after saving — same catchment radii, same tiers, same weights, same curve.
 */
import { conceptFor, tierFor, weightedCompetitorCount, type ConceptDef } from '@/lib/places/competitorRelevance';
import { FORMAT_CATCHMENT_M, competitiveSaturationPct } from '@/lib/modules/territoryMath';
import { VERTICAL_LAYERS, type LayerKey } from './layers';

/** Site formats with Territory Guard's catchment radii (territoryMath.FORMAT_CATCHMENT_M). */
export const SITE_FORMATS = [
  { key: 'inline', label: 'Street / inline', radiusM: FORMAT_CATCHMENT_M.inline },
  { key: 'mall', label: 'Mall unit', radiusM: FORMAT_CATCHMENT_M.mall },
  { key: 'kiosk', label: 'Kiosk / cart', radiusM: FORMAT_CATCHMENT_M.kiosk },
] as const;
export type SiteFormat = (typeof SITE_FORMATS)[number]['key'];

export function catchmentFor(format: string | null | undefined): number {
  return SITE_FORMATS.find((f) => f.key === format)?.radiusM ?? FORMAT_CATCHMENT_M.default;
}

/** Territory Guard's default competitor scan radius (competitorsNear). The capture ring defaults to it. */
export const DEFAULT_SCAN_M = 1500;

/** Franchise verticals an admin can pick (keys match the intake's Vertical enum). */
export const CAPTURE_VERTICALS: Array<{ key: string; label: string }> = [
  { key: 'fnb_qsr', label: 'QSR / Fast food' },
  { key: 'fnb_cafe', label: 'Café / milk tea' },
  { key: 'fnb_bakery', label: 'Bakery' },
  { key: 'convenience', label: 'Convenience store' },
  { key: 'pharmacy', label: 'Pharmacy' },
  { key: 'retail_apparel', label: 'Apparel retail' },
  { key: 'retail_specialty', label: 'Specialty retail' },
  { key: 'services_salon', label: 'Salon' },
  { key: 'services_spa', label: 'Spa' },
  { key: 'services_fitness', label: 'Fitness' },
  { key: 'services_laundry', label: 'Laundry' },
  { key: 'remittance', label: 'Remittance / finance' },
  { key: 'diagnostics', label: 'Diagnostics' },
  { key: 'fuel', label: 'Fuel station' },
  { key: 'automotive', label: 'Automotive' },
  { key: 'hotel', label: 'Hotel' },
  { key: 'education', label: 'Education' },
];

export function isCaptureVertical(v: unknown): v is string {
  return typeof v === 'string' && CAPTURE_VERTICALS.some((x) => x.key === v);
}

/** Most business types one capture can include. */
/** Business types per capture — the playbook's "2–3 at a time" (lib/capture/capturePolicy). */
export const MAX_CAPTURE_VERTICALS = 3;

/** Layers to pull for a site: each chosen vertical's competitor set + the context layers. */
export function layersForSite(verticals: string | string[] | null | undefined, extras: LayerKey[]): LayerKey[] {
  const list = (Array.isArray(verticals) ? verticals : verticals ? [verticals] : []).slice(0, MAX_CAPTURE_VERTICALS);
  const out: LayerKey[] = [];
  for (const v of list) {
    const k = `v:${v}` as LayerKey;
    if (VERTICAL_LAYERS.some((l) => l.key === k) && !out.includes(k)) out.push(k);
  }
  for (const e of extras) if (!out.includes(e)) out.push(e);
  return out.slice(0, 12);
}

export type PlaceTier = 'direct' | 'adjacent' | 'unrelated' | 'context';

export function conceptForSite(vertical: string | null | undefined, brand?: string | null): ConceptDef | null {
  return vertical ? conceptFor(vertical, brand ?? undefined) : null;
}

/** How Territory Guard would classify a place. Non-competitor categories are context (never counted). */
export function tierOfPlace(p: { name: string; category: string }, concept: ConceptDef | null): PlaceTier {
  if (p.category !== 'competitor') return 'context';
  if (!concept) return 'unrelated';
  return tierFor({ name: p.name, primaryType: null }, concept);
}

const TIER_RANK: Record<PlaceTier, number> = { direct: 3, adjacent: 2, unrelated: 1, context: 0 };

/** Strongest tier a place has across several business types (multi-select capture). */
export function tierAcross(p: { name: string; category: string }, concepts: Array<ConceptDef | null>): PlaceTier {
  if (p.category !== 'competitor') return 'context';
  let best: PlaceTier = 'unrelated';
  for (const c of concepts) {
    const t = tierOfPlace(p, c);
    if (TIER_RANK[t] > TIER_RANK[best]) best = t;
  }
  return best;
}

export interface TerritorySummary {
  catchment: { direct: number; adjacent: number; unrelated: number };
  ring: { direct: number; adjacent: number; unrelated: number; context: number };
  weighted: number;
  saturationPct: number;
}

/** Counts exactly as Territory Guard computes them (catchment = format ring; ring = capture area). */
export function summariseForTerritory(
  places: Array<{ tier: PlaceTier; distM: number }>,
  catchmentM: number,
): TerritorySummary {
  const catchment = { direct: 0, adjacent: 0, unrelated: 0 };
  const ring = { direct: 0, adjacent: 0, unrelated: 0, context: 0 };
  for (const p of places) {
    ring[p.tier]++;
    if (p.tier !== 'context' && p.distM <= catchmentM) catchment[p.tier]++;
  }
  const weighted = weightedCompetitorCount(catchment);
  return { catchment, ring, weighted, saturationPct: competitiveSaturationPct(weighted) };
}

/** Parse "14.2846, 121.0966" (also tolerates spaces, a Google-Maps "@lat,lon," URL fragment). */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = /(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{2,3}\.\d+)/.exec(text);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (lat < 4 || lat > 21 || lon < 116 || lon > 127) return null;
  return { lat, lon };
}
