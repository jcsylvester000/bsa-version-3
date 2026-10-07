import { NextRequest } from 'next/server';
import { ok, fail, failValidation } from '@/lib/api/respond';
import { requireAdmin, isJson, captureErrorResponse, SaveBody } from '@/lib/api/adminCapture';
import { saveCapture } from '@/lib/services/capture';

export const maxDuration = 26;

/**
 * POST /api/admin/capture/save — save the places the admin reviewed on the map. The ONLY capture
 * write path: records a committed batch, writes `poi` (OSM places with an intact preview receipt are
 * Verified and may refresh a stored row; everything else is Assumed and never overwrites), tags PSGC,
 * stamps Territory Guard coverage, audit-logs. Idempotent on the OSM key. ADMIN ONLY.
 */
export async function POST(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isJson(req)) return fail({ code: 'unsupported_media_type', message: 'Send JSON.' }, 415);
  const parsed = SaveBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error);
  try {
    return ok(await saveCapture(g.user, parsed.data));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
