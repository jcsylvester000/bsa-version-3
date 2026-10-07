import { NextRequest } from 'next/server';
import { ok, errors } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse } from '@/lib/api/adminCapture';
import { commitBatch } from '@/lib/services/capture';
import { isUuid } from '@/lib/util/uuid';

export const maxDuration = 26;

/**
 * POST /api/admin/capture/batches/:id/commit — write the batch's ACCEPTED items into `poi`, tag them
 * with PSGC barangay/city/province, and mark the batch committed. Refuses while any item is still
 * pending. Re-runnable after a partial failure. ADMIN ONLY — the single write path into `poi` from
 * the capture screen. Audit-logged.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isUuid(params.id)) return errors.notFound('Capture batch');
  try {
    return ok(await commitBatch(g.user, params.id));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
