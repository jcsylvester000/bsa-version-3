import { NextRequest } from 'next/server';
import { ok } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse } from '@/lib/api/adminCapture';
import { demandOverview } from '@/lib/services/demand';

/**
 * GET /api/admin/capture/demand[?days=30] — what users searched for and where they placed intake
 * sites, with the place data BSA had there at that moment (covered / partial / gap) and the
 * back-fill job it started. Personal data (RA 10173): admin only. Read-only.
 */
export async function GET(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const d = Number(req.nextUrl.searchParams.get('days'));
  try {
    return ok(await demandOverview({ days: Number.isFinite(d) && d > 0 ? d : 30 }));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
