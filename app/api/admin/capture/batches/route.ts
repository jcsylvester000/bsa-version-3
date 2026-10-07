import { ok } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse } from '@/lib/api/adminCapture';
import { listBatches } from '@/lib/services/capture';

/** GET /api/admin/capture/batches — the 30 most recent capture batches. Admin only. */
export async function GET() {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  try {
    return ok(await listBatches(30));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
