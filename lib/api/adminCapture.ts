/**
 * Shared plumbing for the /api/admin/capture/* routes: admin gate, JSON body guard, error mapping
 * and the request schemas (zod). Admin ONLY — analysts and brokers get 403 at the API boundary,
 * not just a hidden menu item.
 */
import 'server-only';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { isAdmin, type SessionUser } from '@/lib/auth/auth';
import { errors, fail } from '@/lib/api/respond';
import { CaptureError } from '@/lib/services/capture';
import { CaptureAreaSchema } from '@/lib/capture/area';
import { isLayerKey, type LayerKey } from '@/lib/capture/layers';
import { isCaptureVertical } from '@/lib/capture/territoryAlign';
import { BSA_POI_CATEGORIES, type BsaPoiCategory } from '@/lib/places/osmCategory';

export async function requireAdmin(): Promise<{ user: SessionUser } | { res: Response }> {
  const user = await getSession();
  if (!user) return { res: errors.unauthorized() };
  if (!isAdmin(user)) return { res: errors.forbidden() };
  return { user };
}

/** Mutations must be JSON (with SameSite=Lax cookies this blocks cross-site form posts). */
export function isJson(req: NextRequest): boolean {
  return (req.headers.get('content-type') ?? '').toLowerCase().includes('application/json');
}

/**
 * Map a failure to a safe response. Known database failures get a short reason code (no internals)
 * so the owner can diagnose from the screen, the same pattern as the analysis "[reason: …]" codes.
 */
export function captureErrorResponse(e: unknown): Response {
  if (e instanceof CaptureError) return fail({ code: e.code, message: e.message }, e.status);
  console.error('[admin/capture] failed', e);
  return fail({ code: 'server_error', message: `The capture request failed. Nothing was saved. [reason: ${reasonOf(e)}]` }, 500);
}

export function reasonOf(e: unknown): string {
  const msg = e instanceof Error ? `${(e as { code?: string }).code ?? ''} ${e.message}` : String(e);
  if (/poi_capture_(batch|item)|osm_type|capture_batch_id|column .* does not exist|relation .* does not exist|P2021|P2022/i.test(msg)) return 'db_migration_pending';
  if (/Transactions are not supported in HTTP mode/i.test(msg)) return 'db_http_transaction';
  if (/function similarity|pg_trgm/i.test(msg)) return 'db_pg_trgm_missing';
  if (/st_|postgis|geography/i.test(msg)) return 'db_postgis';
  if (/timeout|timed out|ETIMEDOUT|57014/i.test(msg)) return 'timeout';
  if (/ECONNRESET|ECONNREFUSED|P1001|P1017|fetch failed/i.test(msg)) return 'db_unreachable';
  return 'unexpected';
}

const category = z.enum(BSA_POI_CATEGORIES as [BsaPoiCategory, ...BsaPoiCategory[]]);
const layer = z.string().refine(isLayerKey, 'Unknown layer') as unknown as z.ZodType<LayerKey>;
const label = z.string().trim().max(120).optional();
const lat = z.number().finite().min(4).max(21);
const lon = z.number().finite().min(116).max(127);
const vertical = z.string().refine(isCaptureVertical, 'Unknown business type');
const format = z.enum(['inline', 'mall', 'kiosk']);
const brand = z.string().trim().max(80);

export const SiteContextSchema = z.object({
  site: z.object({ lat, lon }).optional(),
  vertical: vertical.optional(),
  verticals: z.array(vertical).max(6).optional(),
  brand: brand.optional(),
  format: format.optional(),
});

/** POST /preview — fetch only; nothing is written. */
export const PreviewBody = z.object({
  area: CaptureAreaSchema,
  layers: z.array(layer).min(1).max(12),
  /** Include the places BSA already holds inside the area (first call for a ring). */
  withStored: z.boolean().optional(),
  /** Call OpenStreetMap even when the area was captured in the last 90 days. */
  refresh: z.boolean().optional(),
  /** Label + setup, kept with a retry-queue entry if a layer fails. */
  label,
  context: SiteContextSchema.optional(),
});

/** POST /gaps/:id — dismiss or re-open a retry-queue entry. */
export const GapActionBody = z.object({ action: z.enum(['dismiss', 'reopen']) });

/** POST /save — the reviewed places the admin chose to keep. */
export const SaveBody = z.object({
  source: z.enum(['osm', 'navigator_import', 'manual']),
  label,
  area: CaptureAreaSchema.optional(),
  layers: z.array(layer).max(12).optional(),
  fetchedLayers: z.array(layer).max(12).optional(),
  context: SiteContextSchema.optional(),
  items: z.array(z.object({
    osmRef: z.string().regex(/^(node|way|relation)\/\d{1,15}$/).nullish(),
    receipt: z.string().max(64).nullish(),
    name: z.string().trim().min(1).max(200),
    kind: z.string().max(120).nullish(),
    category,
    lat, lon,
    origin: z.enum(['osm', 'file', 'manual']),
    notes: z.string().max(500).nullish(),
  })).max(5_000),
});

/** GET /readiness query. */
export const ReadinessQuery = z.object({
  lat: z.coerce.number().finite().min(4).max(21),
  lon: z.coerce.number().finite().min(116).max(127),
  radiusM: z.coerce.number().int().min(200).max(3_000).optional(),
  format: format.optional(),
  vertical: vertical.optional(),
  /** Comma-separated business types (multi-select). */
  verticals: z.string().max(200).optional().transform((v, ctx) => {
    if (!v) return undefined;
    const list = v.split(',').map((x) => x.trim()).filter(Boolean);
    if (list.length > 6 || !list.every(isCaptureVertical)) { ctx.addIssue({ code: 'custom', message: 'Unknown business type' }); return z.NEVER; }
    return list;
  }),
  brand: brand.optional(),
});

/** "south,west,north,east" with a size cap (map context reads). */
export function parseBboxParam(v: string | null, maxDeg = 0.5): [number, number, number, number] | null {
  if (!v) return null;
  const parts = v.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [s, w, n, e] = parts;
  if (!(n > s && e > w) || s < 4 || n > 21 || w < 116 || e > 127) return null;
  if (n - s > maxDeg || e - w > maxDeg) return null; // default ~55 km — zoom in for context markers
  return [s, w, n, e];
}
