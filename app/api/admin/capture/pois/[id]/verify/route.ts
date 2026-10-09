import { NextRequest } from 'next/server';
import { ok, errors, crossSiteBlock } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse } from '@/lib/api/adminCapture';
import { verifyPoi } from '@/lib/services/capture';

/** POST /api/admin/capture/pois/:id/verify — field-confirm a manual pin (Assumed → Verified). Admin only, audited. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const blocked = crossSiteBlock(req);
  if (blocked) return blocked;
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!/^\d{1,18}$/.test(params.id)) return errors.notFound('Place');
  try {
    return ok(await verifyPoi(g.user, BigInt(params.id)));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
