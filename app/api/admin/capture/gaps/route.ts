import { NextRequest } from 'next/server';
import { ok } from '@/lib/api/respond';
import { requireAdmin, captureErrorResponse } from '@/lib/api/adminCapture';
import { listGaps } from '@/lib/services/capture';

const STATUSES = ['open', 'resolved', 'dismissed', 'all'] as const;

/** GET /api/admin/capture/gaps[?status=open|resolved|dismissed|all] — the retry queue. Read-only. Admin only. */
export async function GET(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  const q = req.nextUrl.searchParams.get('status');
  const status = (STATUSES as readonly string[]).includes(q ?? '') ? (q as (typeof STATUSES)[number]) : 'open';
  try {
    return ok(await listGaps({ status }));
  } catch (e) {
    return captureErrorResponse(e);
  }
}
