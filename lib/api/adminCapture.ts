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

export function captureErrorResponse(e: unknown): Response {
  if (e instanceof CaptureError) return fail({ code: e.code, message: e.message }, e.status);
  console.error('[admin/capture] failed', e);
  return errors.server('The capture request failed. Nothing was saved to the places table.');
}

const category = z.enum(BSA_POI_CATEGORIES as [BsaPoiCategory, ...BsaPoiCategory[]]);
const layer = z.string().refine(isLayerKey, 'Unknown layer') as unknown as z.ZodType<LayerKey>;
const label = z.string().trim().max(120).optional();
const lat = z.number().finite().min(4).max(21);
const lon = z.number().finite().min(116).max(127);

export const PreviewBody = z.object({
  area: CaptureAreaSchema,
  layers: z.array(layer).min(1).max(12),
  label,
});

export const ManualBody = z.object({
  batchId: z.string().uuid().optional(),
  lat, lon,
  name: z.string().trim().min(1).max(200),
  category,
  notes: z.string().max(500).optional(),
});

export const ItemsPatchBody = z.object({
  updates: z.array(z.object({
    id: z.string().regex(/^\d{1,18}$/),
    decision: z.enum(['accept', 'reject', 'pending']).optional(),
    name: z.string().max(200).optional(),
    category: category.optional(),
  })).min(1).max(1_000),
});

/** "south,west,north,east" with a size cap (map context reads). */
export function parseBboxParam(v: string | null): [number, number, number, number] | null {
  if (!v) return null;
  const parts = v.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [s, w, n, e] = parts;
  if (!(n > s && e > w) || s < 4 || n > 21 || w < 116 || e > 127) return null;
  if (n - s > 0.5 || e - w > 0.5) return null; // ~55 km — zoom in for context markers
  return [s, w, n, e];
}
