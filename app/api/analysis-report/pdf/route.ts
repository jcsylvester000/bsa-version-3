import React from 'react';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { errors } from '@/lib/api/respond';
import { generateAnalysisReport } from '@/lib/ai/analysisReport';
import { AnalysisPdf } from '@/lib/pdf/AnalysisPdf';

// @react-pdf needs the Node runtime (not edge); the report is per-request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/analysis-report/pdf?runId=…&siteId=… — the branded, server-generated PDF of a
 * site's Analysis Report (Grid identity). Returns the cached analysis (generating it if
 * missing) and renders it. Access-scoped to the run's franchisor.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const runId = req.nextUrl.searchParams.get('runId');
  const siteId = req.nextUrl.searchParams.get('siteId');
  if (!runId || !siteId || !isUuid(runId) || !isUuid(siteId)) return errors.notFound('Report');

  const run = await prisma.pipelineRun.findUnique({ where: { id: runId } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  const site = await prisma.candidateSite.findUnique({ where: { id: siteId }, select: { pipelineRunId: true } });
  if (!site || site.pipelineRunId !== runId) return errors.notFound('Site');

  try {
    // Cached analysis (or generate it if this site somehow has none yet).
    const result = await generateAnalysisReport(runId, siteId, { actorId: session.id });
    const meta = ((result.contextJson ?? {}) as { meta?: Record<string, unknown> }).meta ?? {};
    const siteLabel = String(meta.siteLabel ?? 'Site');
    const brand = meta.brand != null ? String(meta.brand) : null;
    const location = meta.city != null ? String(meta.city) : null;
    const dateStr = new Date(result.generatedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });

    const { renderToBuffer } = await import('@react-pdf/renderer');
    const element = React.createElement(AnalysisPdf, {
      siteLabel,
      brand,
      location,
      dateStr,
      confidence: result.confidence,
      narrative: result.analysis,
      schemaText: result.schemaText,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(element as any);

    const safe = siteLabel.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'site';
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="BSA_Analysis_${safe}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return errors.server(`Could not build the PDF: ${e instanceof Error ? e.message : String(e)}`);
  }
}
