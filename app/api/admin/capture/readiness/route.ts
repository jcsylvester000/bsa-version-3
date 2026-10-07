import { NextRequest } from 'next/server';
import { ok, failValidation } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse, ReadinessQuery } from '@/lib/api/adminCapture';
import { siteReadiness } from '@/lib/services/capture';

/**
 * GET /api/admin/capture/readiness?lat&lon[&radiusM&format&vertical&brand] — what Territory Guard
 * sees around a site pin right now (same query, tiers, catchment and saturation curve), plus the
 * PSGC barangay/city/province the pin falls in. Read-only. Admin only.
 */
export async function GET(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const q = Object.fromEntries([...req.nextUrl.searchParams.entries()].filter(([, v]) => v !== ''));
  const parsed = ReadinessQuery.safeParse(q);
  if (!parsed.success) return failValidation(parsed.error);
  try {
    return ok(await siteReadiness(parsed.data));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
