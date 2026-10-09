import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { requireAdmin, isJson, captureErrorResponse } from '@/lib/api/adminCapture';
import { autofillOverview, runAutofill, setJobStatus } from '@/lib/services/autofill';
import { queueFillForDemand } from '@/lib/services/demand';
import { checkLimit, recordAttempt } from '@/lib/auth/rateLimit';
import { audit } from '@/lib/audit/audit';
import { isUuid } from '@/lib/util/uuid';

export const maxDuration = 26;

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('run') }),
  z.object({ action: z.literal('queue'), demandId: z.string().uuid() }),
  z.object({ action: z.enum(['cancel', 'retry']), jobId: z.string().uuid() }),
]);

/** GET /api/admin/capture/autofill — the back-fill queue, its switches and today's usage. Admin only. */
export async function GET() {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  try {
    return ok(await autofillOverview());
  } catch (e) {
    return captureErrorResponse(e);
  }
}

/**
 * POST /api/admin/capture/autofill — { action: 'run' } runs one pass now (same guard rails as the
 * schedule); { action: 'queue', demandId } queues a back-fill for a user's request; { action:
 * 'cancel' | 'retry', jobId }. JSON only. Admin only, audited; "run" is rate-limited.
 */
export async function POST(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isJson(req)) return fail({ code: 'unsupported_media_type', message: 'Send JSON.' }, 415);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error);
  const actorId = isUuid(g.user.id) ? g.user.id : null;
  try {
    const b = parsed.data;
    if (b.action === 'run') {
      const lim = await checkLimit('autofill_run', 'admin_capture', g.user.id, { max: 30, windowMs: 60 * 60_000 });
      if (lim.limited) return errors.tooMany(lim.retryAfterSeconds, 'Run limit reached for this hour.');
      await recordAttempt('autofill_run', 'admin_capture', g.user.id);
      return ok(await runAutofill({ trigger: 'admin', budgetMs: 20_000, actorId }));
    }
    if (b.action === 'queue') {
      const r = await queueFillForDemand(b.demandId, actorId);
      if (!r) return errors.notFound('Request');
      await audit({ actorId, action: 'poi.autofill.queue', entity: 'location_demand', entityId: b.demandId, meta: r });
      return ok(r);
    }
    const done = await setJobStatus(b.jobId, b.action);
    if (!done) return fail({ code: 'conflict', message: b.action === 'cancel' ? 'Only queued or running jobs can be cancelled.' : 'Only finished jobs can be retried (and not while the same area is queued).' }, 409);
    await audit({ actorId, action: `poi.autofill.${b.action}`, entity: 'poi_fill_job', entityId: b.jobId, meta: {} });
    return ok({ jobId: b.jobId, action: b.action });
  } catch (e) {
    return captureErrorResponse(e);
  }
}
