import { NextRequest } from 'next/server';
import { ok, errors } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse } from '@/lib/api/adminCapture';
import { getBatch } from '@/lib/services/capture';
import { isUuid } from '@/lib/util/uuid';

/** GET /api/admin/capture/batches/:id — a saved capture and the places it saved (view on the map). Admin only. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
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
