import { NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse, parseBboxParam } from '@/lib/api/adminCapture';
import { poisInBbox } from '@/lib/services/capture';

/** GET /api/admin/capture/pois?bbox=south,west,north,east — places already in BSA (map context). Admin only. */
export async function GET(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const bbox = parseBboxParam(req.nextUrl.searchParams.get('bbox'));
  if (!bbox) return fail({ code: 'bad_bbox', message: 'Zoom in further (bbox must be within the Philippines and under ~55 km a side).' }, 422);
  try {
    return ok(await poisInBbox(bbox));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
