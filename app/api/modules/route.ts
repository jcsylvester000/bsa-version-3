import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, fail, errors } from '@/lib/api/respond';

/**
 * GET /api/modules?runId=... — all module_results for a run, grouped by module,
 * for the modules overview. Access-scoped to the run's franchisor.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const runId = req.nextUrl.searchParams.get('runId');
  if (!runId) return fail({ code: 'bad_request', message: 'runId is required.' }, 400);
  if (!isUuid(runId)) return errors.notFound('Run'); // guard: non-UUID → 404, not a DB 500

  const run = await prisma.pipelineRun.findUnique({ where: { id: runId } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  const rows = await prisma.moduleResult.findMany({
    where: { pipelineRunId: runId },
    include: { site: { select: { id: true, label: true } } },
    orderBy: [{ module: 'asc' }],
  });

  return ok({
    runId,
    status: run.status,
    confidence: run.confidence,
    results: rows.map((r) => ({
      module: r.module,
      site: r.site,
      score: r.score != null ? Number(r.score) : null,
      truthLayer: r.truthLayer,
      flags: r.flags,
      payload: r.payload,
    })),
  });
}
