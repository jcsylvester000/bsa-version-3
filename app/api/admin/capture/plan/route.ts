import { NextRequest } from 'next/server';
import { ok, fail, failValidation } from '@/lib/api/respond';
import { requireAdmin, isJson, captureErrorResponse, PlanBody } from '@/lib/api/adminCapture';
import { planCapture } from '@/lib/services/capture';

/**
 * POST /api/admin/capture/plan — the capture pre-flight (playbook as code): layers already captured
 * (skipped), open retry entries in the area, the ring rule for this spot, barangay boundaries, earlier
 * captures. READ-ONLY (POST only because the area is a JSON body). Admin only.
 */
export async function POST(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isJson(req)) return fail({ code: 'unsupported_media_type', message: 'Send JSON.' }, 415);
  const parsed = PlanBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error);
  try {
    return ok(await planCapture(parsed.data));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
