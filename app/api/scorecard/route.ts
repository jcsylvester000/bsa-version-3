import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, fail, errors } from '@/lib/api/respond';
import { buildScorecardsForRun } from '@/lib/modules/scorecardServer';

/**
 * GET /api/scorecard?runId=... — the one-page Self-Serve Site Scorecard(s) for a run.
 * Built deterministically from the run's module results. Access-scoped.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const runId = req.nextUrl.searchParams.get('runId');
  if (!runId) return fail({ code: 'bad_request', message: 'runId is required.' }, 400);
  if (!isUuid(runId)) return errors.notFound('Run'); // guard: non-UUID → 404, not a DB 500

  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } } },
  });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  const scorecards = await buildScorecardsForRun(runId);
  return ok({ runId, brandName: run.franchisor.brandName, scorecards });
}
