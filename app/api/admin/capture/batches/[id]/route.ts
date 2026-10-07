import { NextRequest } from 'next/server';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { requireAdmin, isJson, captureErrorResponse, ItemsPatchBody } from '@/lib/api/adminCapture';
import { getBatch, updateItems, discardBatch } from '@/lib/services/capture';
import { isUuid } from '@/lib/util/uuid';

type Ctx = { params: { id: string } };

/** GET /api/admin/capture/batches/:id — batch + staged items for review. Admin only. */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isUuid(params.id)) return errors.notFound('Capture batch');
  try {
    const b = await getBatch(params.id);
    return b ? ok(b) : errors.notFound('Capture batch');
  } catch (e) {
    return captureErrorResponse(e);
  }
}

/** PATCH /api/admin/capture/batches/:id — review edits { updates: [{ id, decision?, name?, category? }] }. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isUuid(params.id)) return errors.notFound('Capture batch');
  if (!isJson(req)) return fail({ code: 'unsupported_media_type', message: 'Send JSON.' }, 415);
  const parsed = ItemsPatchBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error);
  try {
    return ok(await updateItems(g.user, params.id, parsed.data.updates));
  } catch (e) {
    return captureErrorResponse(e);
  }
}

/** DELETE /api/admin/capture/batches/:id — discard a draft (kept for the audit trail, never committed). */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isUuid(params.id)) return errors.notFound('Capture batch');
  try {
    return ok(await discardBatch(g.user, params.id));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
