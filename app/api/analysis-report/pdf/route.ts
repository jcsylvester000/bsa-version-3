import React from 'react';
import { manilaLongStamp } from '@/lib/util/manilaTime';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { errors, fail } from '@/lib/api/respond';
import { readAnalysis } from '@/lib/ai/analysisReport';
import { AnalysisPdf } from '@/lib/pdf/AnalysisPdf';

// @react-pdf needs the Node runtime (not edge); the report is per-request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/analysis-report/pdf?runId=…&siteId=… — the branded, server-generated PDF of a
 * site's Analysis Report (Grid identity). READ-ONLY: renders the cached analysis and never
 * triggers a (paid) generation — a GET must be safe to open, prefetch or retry. If no report
 * exists yet it answers 409 and the UI asks the user to generate first. Access-scoped per run.
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
    const state = await readAnalysis(siteId);
    if (state.state !== 'ready') {
      return fail(
        {
          code: state.state === 'generating' ? 'analysis_generating' : 'analysis_missing',
          message: state.state === 'generating'
            ? 'The analysis is still being written. Try the PDF again in a moment.'
            : 'Generate the analysis for this site before exporting the PDF.',
        },
        409,
      );
    }
    const result = state.result;
    const meta = ((result.contextJson ?? {}) as { meta?: Record<string, unknown> }).meta ?? {};
    const siteLabel = String(meta.siteLabel ?? 'Site');
    const brand = meta.brand != null ? String(meta.brand) : null;
    const location = meta.city != null ? String(meta.city) : null;
    // Manila time regardless of the server's zone (Netlify runs in UTC).
    const dateStr = manilaLongStamp(new Date(result.generatedAt));

    const { renderToBuffer } = await import('@react-pdf/renderer');
    const element = React.createElement(AnalysisPdf, {
      siteLabel,
      brand,
      location,
      dateStr,
      confidence: result.confidence,
      narrative: result.analysis,
      schemaText: result.schemaText,
      checkWarning: result.check && !result.check.ok
        ? [
            result.check.ungroundedNumbers.length ? `figures not matched to the site data: ${result.check.ungroundedNumbers.join(', ')}` : '',
            result.check.priceVerdictPhrases.length ? `price-verdict wording: ${result.check.priceVerdictPhrases.join(', ')}` : '',
          ].filter(Boolean).join('; ')
        : null,
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
    console.error(`[analysis-pdf] run=${runId} site=${siteId}`, e);
    return errors.server('Could not build the PDF. Please try again.');
  }
}
