import React from 'react';
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { errors } from '@/lib/api/respond';
import { getSiteReport } from '@/lib/services/sites';
import { isPrimaryModule } from '@/lib/modules/verticalConfig';
import { buildSiteReportModel, payloadsFromRows, siteReportMeta } from '@/lib/modules/siteReportModel';
import { manilaLongStamp } from '@/lib/util/manilaTime';
import { AnalysisPdf } from '@/lib/pdf/AnalysisPdf';
import type { ModuleKind } from '@prisma/client';

// @react-pdf needs the Node runtime (not edge); the report is per-request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/analysis-report/pdf?runId=…&siteId=… — the site's Final Report as a branded PDF.
 *
 * Built from the SAME data path and model as the Final Report tab: `getSiteReport` (the one authorized,
 * access-scoped site read, F-47) → `payloadsFromRows` + `siteReportMeta` → `buildSiteReportModel`
 * (lib/modules/siteReportModel.ts). So the PDF carries exactly what the user sees on screen — the
 * recommendation, what drove the call and the four module summaries, each figure with its Truth Layer —
 * as real text, not a screenshot. READ-ONLY and deterministic (no AI, no external call): safe to open,
 * prefetch or retry.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const result = await getSiteReport(session, req.nextUrl.searchParams.get('runId') ?? undefined, req.nextUrl.searchParams.get('siteId') ?? undefined);
  if (result.kind === 'forbidden') return errors.forbidden();
  if (result.kind !== 'ok') return errors.notFound(result.kind === 'not_found' ? 'Run' : result.kind === 'site_not_in_run' ? 'Site' : 'Report');
  const { run, site, rows, runSites } = result.data;

  try {
    const model = buildSiteReportModel({
      payloads: payloadsFromRows(rows),
      verdict: site.verdict ?? null,
      isPrimary: (k) => isPrimaryModule(run.vertical, k as ModuleKind),
      meta: siteReportMeta({ site, run, rows, runSites }),
    });

    const { renderToBuffer } = await import('@react-pdf/renderer');
    const element = React.createElement(AnalysisPdf, {
      model,
      siteLabel: site.label,
      brand: run.franchisor?.brandName ?? null,
      location: site.city ?? null,
      generatedAt: manilaLongStamp(new Date()), // Manila time regardless of the server zone (UTC on Netlify)
    });
    // @react-pdf types renderToBuffer's arg as ReactElement<DocumentProps>; cast to its own parameter type.
    const buffer = await renderToBuffer(element as unknown as Parameters<typeof renderToBuffer>[0]);

    const safe = site.label.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'site';
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="BSA_Final_Report_${safe}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    console.error(`[site-pdf] run=${run.id} site=${site.id}`, e);
    return errors.server('Could not build the PDF. Please try again.');
  }
}
