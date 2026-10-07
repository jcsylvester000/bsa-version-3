import { NextRequest } from 'next/server';
import { ok, fail, failValidation } from '@/lib/api/respond';
import { requireAdmin, isJson, captureErrorResponse, ManualBody } from '@/lib/api/adminCapture';
import { addManualPin } from '@/lib/services/capture';

/**
 * POST /api/admin/capture/manual — add one hand-placed pin to a draft batch (or start a new
 * "Manual pins" batch). Manual pins are Assumed until field-verified. Admin only.
 * Body: { batchId?, lat, lon, name, category, notes? }
 */
export async function POST(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isJson(req)) return fail({ code: 'unsupported_media_type', message: 'Send JSON.' }, 415);
  const parsed = ManualBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error);
  try {
    return ok(await addManualPin(g.user, parsed.data));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
