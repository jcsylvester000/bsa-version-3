import { NextRequest } from 'next/server';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { requireAdmin, isJson, captureErrorResponse, GapActionBody } from '@/lib/api/adminCapture';
import { getGap, setGapStatus } from '@/lib/services/capture';

/** GET /api/admin/capture/gaps/:id — one retry-queue entry (area, layer, setup) to re-run it. Admin only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  try {
    const gap = await getGap(params.id);
    return gap ? ok(gap) : errors.notFound('Retry entry');
  } catch (e) {
    return captureErrorResponse(e);
  }
}

/** POST /api/admin/capture/gaps/:id { action: 'dismiss' | 'reopen' } — JSON only. Admin only, audited. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isJson(req)) return fail({ code: 'unsupported_media_type', message: 'Send JSON.' }, 415);
  const parsed = GapActionBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error);
  try {
    return ok(await setGapStatus(g.user, params.id, parsed.data.action));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
