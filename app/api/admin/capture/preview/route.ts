import { NextRequest } from 'next/server';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { requireAdmin, isJson, captureErrorResponse, PreviewBody } from '@/lib/api/adminCapture';
import { previewArea } from '@/lib/services/capture';
import { checkLimit, recordAttempt } from '@/lib/auth/rateLimit';

// Live Overpass pull with an 18 s budget inside the service.
export const maxDuration = 26;

/** Per-admin cap on live OSM pulls (be kind to public Overpass). */
const PREVIEW_LIMIT = { max: 240, windowMs: 60 * 60_000 }; // the screen loads one layer per request

/**
 * POST /api/admin/capture/preview — pull places for an area from OpenStreetMap (server-side) and
 * return them for the map. READ-ONLY: nothing is written to the database; the admin reviews on the
 * map and then calls /save. Admin only.
 * Body: { area: {kind:'rect',south,west,north,east} | {kind:'circle',lat,lon,radiusM}, layers: string[] }
 */
export async function POST(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isJson(req)) return fail({ code: 'unsupported_media_type', message: 'Send JSON.' }, 415);
  const parsed = PreviewBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error);

  const lim = await checkLimit('capture_preview', 'admin_capture', g.user.id, PREVIEW_LIMIT);
  if (lim.limited) return errors.tooMany(lim.retryAfterSeconds, 'Capture limit reached for this hour. Try again later.');
  await recordAttempt('capture_preview', 'admin_capture', g.user.id);

  try {
    return ok(await previewArea(g.user, parsed.data));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
