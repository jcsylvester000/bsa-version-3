import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun, canRunPipeline } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, errors } from '@/lib/api/respond';
import { runPipeline } from '@/lib/modules/orchestrator';
import { audit } from '@/lib/audit/audit';
import { captureException } from '@/lib/monitoring/report';

/**
 * POST /api/runs/[id]/run — execute one time-boxed slice of the deterministic pipeline.
 * The client re-invokes until `complete: true`. Body `{ refresh: true }` restarts a finished run.
 *
 * Each slice self-limits to PIPELINE_BUDGET_MS (~5.5s) and hands back to the client, but at least
 * one site always runs fully — so the function must be allowed the full platform budget or a slow
 * first site is killed mid-processing and retried forever (audit F-04). maxDuration pins that.
 */
// Netlify synchronous functions allow up to 26s; give the slice the full window.
export const maxDuration = 26;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!canRunPipeline(session)) return errors.forbidden();
  if (!isUuid(params.id)) return errors.notFound('Run'); // guard: non-UUID → 404, not a DB 500

  const run = await prisma.pipelineRun.findUnique({ where: { id: params.id } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  // Body `{ refresh: true }` (first call of a manual re-run) recomputes a finished run from
  // scratch; later calls (no body) resume the time-boxed slices. The Final Report recommendation
  // is derived live from the refreshed module results, so there is nothing extra to regenerate.
  const body = (await req.json().catch(() => null)) as { refresh?: unknown } | null;
  const refresh = body?.refresh === true;

  let result;
  try {
    result = await runPipeline(run.id, { refresh });
  } catch (err) {
    // Run already marked `failed` inside runPipeline. Report to the monitor; generic message out.
    await captureException(err, { code: 'pipeline_failed', route: `POST /api/runs/${run.id}/run` });
    return errors.server('The analysis could not be completed. Please try again.');
  }

  await audit({
    actorId: session.id,
    action: 'run_pipeline',
    entity: 'pipeline_run',
    entityId: run.id,
    meta: { status: result.status, confidence: result.confidence, modules: result.modulesRun.length },
  });

  return ok(result);
}
