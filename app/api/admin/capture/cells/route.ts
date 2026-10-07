import { NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse, parseBboxParam } from '@/lib/api/adminCapture';
import { coverageCells } from '@/lib/services/capture';

/**
 * GET /api/admin/capture/cells?bbox=s,w,n,e&layer=KEY — Territory Guard coverage cells (~1.1 km) with
 * when each was last captured, for one coverage key (a vertical such as `fnb_qsr`, or `layer:anchors`).
 * Read-only. Admin only.
 */
export async function GET(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const bbox = parseBboxParam(req.nextUrl.searchParams.get('bbox'), 2);
  if (!bbox) return fail({ code: 'bad_bbox', message: 'Zoom in further to see coverage cells.' }, 422);
  const layer = req.nextUrl.searchParams.get('layer') ?? '';
  if (!/^(layer:)?[a-z_]{2,40}$/.test(layer)) return fail({ code: 'bad_layer', message: 'Pick a business type or layer.' }, 422);
  try {
    return ok(await coverageCells(bbox, layer));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
