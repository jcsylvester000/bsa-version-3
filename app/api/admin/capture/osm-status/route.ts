import { ok } from '@/lib/api/respond';
import { requireAdmin } from '@/lib/api/adminCapture';
import { overpassStatus } from '@/lib/places/osmService';
import { osmWindow } from '@/lib/capture/capturePolicy';

/**
 * GET /api/admin/capture/osm-status — is OpenStreetMap ready for a capture right now? Live Overpass slot
 * status for this server (cached 20 s) + the Philippine-time off-peak window. Read-only. Admin only.
 */
export async function GET() {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const status = await overpassStatus();
  return ok({ ...status, window: osmWindow() });
}
