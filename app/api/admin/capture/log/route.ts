import { NextRequest } from 'next/server';
import { ok } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse } from '@/lib/api/adminCapture';
import { captureLog } from '@/lib/services/capture';

/**
 * GET /api/admin/capture/log[?days=N] — the capture log for the Coverage screen: every saved capture
 * area (where, when, who, layers loaded, places saved), the retry queue, totals, POI counts per region.
 * Read-only. Admin only.
 */
export async function GET(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const d = Number(req.nextUrl.searchParams.get('days'));
  const days = Number.isFinite(d) && d > 0 ? Math.min(3_650, Math.round(d)) : undefined;
  try {
    return ok(await captureLog({ days }));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
