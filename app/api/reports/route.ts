import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun, canRunPipeline } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { composeReport } from '@/lib/modules/reportComposer';
import { renderAndPersistReport } from '@/lib/modules/reportRender';
import { getStorage } from '@/lib/storage';
import { audit } from '@/lib/audit/audit';

const genSchema = z.object({ runId: z.string().uuid() });

/**
 * POST /api/reports — compose + store the 9-section Site Intelligence Report for a run.
 * Deterministic module data grounds it; the AI phrases each section. Returns the
 * report metadata and a signed download URL.
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
    const persisted = await renderAndPersistReport(composed, generatedAtISO);

    const downloadUrl = await getStorage().signedUrl(persisted.storageKey, { expiresInSeconds: 300, download: true });

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
      downloadUrl,
    });
  } catch (err) {
    console.error('[POST /api/reports] generate failed', err);
    const message = err instanceof Error ? err.message : 'Failed to generate report.';
    return errors.server(message);
  }
}

/**
 * GET /api/reports?runId=... — fetch the stored report row + a fresh signed download URL.
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
  if (!report || !report.storageKey) return errors.notFound('Report');

  const downloadUrl = await getStorage().signedUrl(report.storageKey, { expiresInSeconds: 300, download: true });
  return ok({
    reportId: report.id,
    confidence: report.confidence,
    generatedAt: report.generatedAt,
    downloadUrl,
  });
}
