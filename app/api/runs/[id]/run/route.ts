import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun, canRunPipeline } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, errors } from '@/lib/api/respond';
import { runPipeline } from '@/lib/modules/orchestrator';
import { audit } from '@/lib/audit/audit';

/**
 * POST /api/runs/[id]/run — execute one time-boxed slice of the deterministic pipeline.
 * The client re-invokes until `complete: true`. Body `{ refresh: true }` restarts a finished
 * run (also clears its cached AI analyses, which would no longer match the new figures).
 *
 * AI generation is deliberately NOT done here (Batch 2): fanning out one live-model call per
 * site inside this request blew through the serverless function limit. When the run
 * completes, the client requests each site's analysis separately via
 * POST /api/analysis-report (one site per invocation, locked against double-billing), and the
 * Analysis tab generates on demand for any site still missing one.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!canRunPipeline(session)) return errors.forbidden();
  if (!isUuid(params.id)) return errors.notFound('Run'); // guard: non-UUID → 404, not a DB 500

  const run = await prisma.pipelineRun.findUnique({ where: { id: params.id } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  // Body `{ refresh: true }` (first call of a manual re-run) recomputes a finished run from
  // scratch; later calls (no body) resume the time-boxed slices.
  const body = (await req.json().catch(() => null)) as { refresh?: unknown } | null;
  const refresh = body?.refresh === true;

  let result;
  try {
    result = await runPipeline(run.id, { refresh });
  } catch {
    // Logged + run marked `failed` inside runPipeline. Generic message to the client.
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
