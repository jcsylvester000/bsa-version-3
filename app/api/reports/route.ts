import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun, canRunPipeline } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { composeReport } from '@/lib/modules/reportComposer';
import { recordReport } from '@/lib/modules/reportRender';
import { audit } from '@/lib/audit/audit';

const genSchema = z.object({ runId: z.string().uuid() });

/**
 * POST /api/reports — compose the 9-section Run Report (all sites of a run) and record that it
 * was generated. Built on demand from the database; the client-ready branded version is
 * GET /api/reports/full (HTML → print to PDF). No file storage (Batch 5).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!canRunPipeline(session)) return errors.forbidden();

  const body = await req.json().catch(() => null);
  const parsed = genSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  const run = await prisma.pipelineRun.findUnique({ where: { id: parsed.data.runId } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  try {
    const composed = await composeReport(run.id);
    // generatedAt stamped here at runtime (not inside any workflow script).
    const generatedAtISO = new Date().toISOString();
    const persisted = await recordReport(composed, generatedAtISO);

    await audit({
      actorId: session.id,
      action: 'generate_report',
      entity: 'report',
      entityId: persisted.reportId,
      meta: { runId: run.id, confidence: persisted.confidence },
    });

    return ok({
      reportId: persisted.reportId,
      runId: run.id,
      confidence: composed.confidence,
      truthLayerMix: composed.truthLayerMix,
      sections: composed.sections.map((s) => ({
        number: s.number,
        title: s.title,
        text: s.text,
        truthLayers: Array.from(new Set(s.truthLayers)),
        assessed: s.assessed,
        metrics: s.metrics, // structured, AI-free data the UI renders as visuals
      })),
      onGroundCheckFlagged: composed.onGroundCheckFlagged,
      fullReportPath: `/api/reports/full?runId=${run.id}`,
    });
  } catch (err) {
    console.error('[POST /api/reports] generate failed', err);
    return errors.server('The report could not be generated. Please try again.');
  }
}

/**
 * GET /api/reports?runId=... — whether a run report has been generated (confidence + when).
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

  const report = await prisma.report.findUnique({ where: { pipelineRunId: runId } });
  if (!report) return errors.notFound('Report');
  return ok({
    reportId: report.id,
    confidence: report.confidence,
    generatedAt: report.generatedAt,
    fullReportPath: `/api/reports/full?runId=${runId}`,
  });
}
