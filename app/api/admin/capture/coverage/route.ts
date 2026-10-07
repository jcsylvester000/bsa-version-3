import { ok } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse } from '@/lib/api/adminCapture';
import { coverage } from '@/lib/services/capture';

/** GET /api/admin/capture/coverage — committed capture areas (GeoJSON) + POI totals per region. Admin only. */
export async function GET() {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  try {
    return ok(await coverage());
  } catch (e) {
    return captureErrorResponse(e);
  }
}
