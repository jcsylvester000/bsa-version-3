import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun, canRunPipeline } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, errors } from '@/lib/api/respond';
import { runPipeline } from '@/lib/modules/orchestrator';
import { generateAnalysisReport } from '@/lib/ai/analysisReport';
import { audit } from '@/lib/audit/audit';

/**
 * POST /api/runs/[id]/run — execute the deterministic pipeline for a run.
 * Sequences the vertical's modules across all candidate sites, writes results,
 * and sets run status + confidence. Returns the per-site summary.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!canRunPipeline(session)) return errors.forbidden();
  if (!isUuid(params.id)) return errors.notFound('Run'); // guard: non-UUID → 404, not a DB 500

  const run = await prisma.pipelineRun.findUnique({ where: { id: params.id } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  const result = await runPipeline(run.id);

  // When the run finalizes (every site's modules are computed), pre-generate the AI Analysis
  // Report for EVERY candidate site so it's ready on the analysis page and never re-run. Blocks
  // until done (product choice). Each site is an independent, brand-new AI run; a per-site failure
  // is logged and skipped so one bad call can't fail the whole submission.
  if (result.complete) {
    const sites = await prisma.candidateSite.findMany({
      where: { pipelineRunId: run.id },
      select: { id: true },
    });
    await Promise.all(
      sites.map((s) =>
        generateAnalysisReport(run.id, s.id, { actorId: session.id }).catch((e) => {
          console.error(`[analysis] generation failed for site ${s.id}:`, e instanceof Error ? e.message : e);
        }),
      ),
    );
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
