import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, fail, errors } from '@/lib/api/respond';
import { generateAnalysisReport } from '@/lib/ai/analysisReport';

/**
 * POST /api/analysis-report — generate (or return the cached) AI Analysis Report for one
 * site in a run. The report is written ONLY from the strict JSON of the four module results
 * (Territory Guard, Lease Benchmark, Daypart, White-Space) + intake — retrieve-then-generate.
 * Body: { runId, siteId, force? }. `force: true` regenerates and overwrites the cache.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const body = (await req.json().catch(() => null)) as { runId?: string; siteId?: string; force?: boolean } | null;
  const runId = body?.runId;
  const siteId = body?.siteId;
  if (!runId || !siteId || !isUuid(runId) || !isUuid(siteId)) {
    return fail({ code: 'bad_request', message: 'A valid runId and siteId are required. The Analysis Report runs on a real, completed analysis.' }, 400);
  }

  const run = await prisma.pipelineRun.findUnique({ where: { id: runId } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  const site = await prisma.candidateSite.findUnique({ where: { id: siteId }, select: { pipelineRunId: true } });
  if (!site || site.pipelineRunId !== runId) return errors.notFound('Site');

  try {
    const result = await generateAnalysisReport(runId, siteId, { force: body?.force === true, actorId: session.id });
    return ok(result);
  } catch (e) {
    return errors.server(`Could not generate the analysis: ${e instanceof Error ? e.message : String(e)}`);
  }
}
