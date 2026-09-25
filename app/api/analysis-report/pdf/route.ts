import React from 'react';
import { manilaLongStamp } from '@/lib/util/manilaTime';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { errors } from '@/lib/api/respond';
import { summariseSite, summaryToText } from '@/lib/modules/siteVerdict';
import { isPrimaryModule } from '@/lib/modules/verticalConfig';
import { AnalysisPdf } from '@/lib/pdf/AnalysisPdf';
import type { ModuleKind } from '@prisma/client';

// @react-pdf needs the Node runtime (not edge); the report is per-request.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/analysis-report/pdf?runId=…&siteId=… — the branded, server-generated PDF of a site's
 * recommendation (Grid identity). READ-ONLY and deterministic: it rolls the site's module results
 * into the same PROCEED / CAUTIOUS / NO-GO summary shown on screen (no AI, no external call), so a
 * GET is always safe to open, prefetch or retry. Access-scoped per run.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const runId = req.nextUrl.searchParams.get('runId');
  const siteId = req.nextUrl.searchParams.get('siteId');
  if (!runId || !siteId || !isUuid(runId) || !isUuid(siteId)) return errors.notFound('Report');

  const run = await prisma.pipelineRun.findUnique({ where: { id: runId }, select: { franchisorId: true, vertical: true, createdByUserId: true } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  const site = await prisma.candidateSite.findUnique({ where: { id: siteId }, select: { pipelineRunId: true, label: true, city: true, verdict: true } });
  if (!site || site.pipelineRunId !== runId) return errors.notFound('Site');

  try {
    // Build the deterministic recommendation from the site's stored module results.
    const rows = await prisma.moduleResult.findMany({
      where: { candidateSiteId: siteId, module: { in: ['territory', 'lease', 'daypart', 'whitespace'] as ModuleKind[] } },
      select: { module: true, payload: true },
    });
    const p = (k: string) => (rows.find((r) => r.module === k)?.payload ?? null) as Record<string, unknown> | null;
    const t = p('territory'); const l = p('lease'); const d = p('daypart'); const w = p('whitespace');
    const wRecs = (w?.recommendations as Array<{ verdict?: string | null }> | undefined) ?? null;
    const summary = summariseSite(
      {
        territory: t ? { verdict: t.verdict as string ?? null, totalCannibalizedPhp: (t.totalCannibalizedPhp as number) ?? null, competitiveSaturationPct: (t.competitiveSaturationPct as number) ?? null } : null,
        lease: l ? { verdict: (l.verdict as string) ?? null, corridor: (l.corridor as string) ?? null } : null,
        daypart: d ? { windowMatchPct: (d.windowMatchPct as number) ?? null, noCatchmentData: (d.noCatchmentData as boolean) ?? null } : null,
        whitespace: wRecs ? { recommendations: wRecs.map((r) => ({ verdict: r.verdict ?? null })) } : null,
      },
      (k) => isPrimaryModule(run.vertical, k as ModuleKind),
      // Same band as the dashboard drives the call (audit F-07) — the PDF can't disagree with the app.
      (site.verdict as 'go' | 'caution' | 'nogo' | null) ?? 'insufficient',
    );

    const franchisor = run.franchisorId
      ? await prisma.franchisor.findUnique({ where: { id: run.franchisorId }, select: { brandName: true } })
      : null;
    const dateStr = manilaLongStamp(new Date()); // Manila time regardless of the server zone (UTC on Netlify).
    const coverageConfidence = summary.coverage >= 3 ? 'high' : summary.coverage >= 2 ? 'medium' : 'low';
    const modulesIncluded = ['territory', 'lease', 'daypart', 'whitespace'].filter((k) => p(k)).join(', ') || 'none';

    const { renderToBuffer } = await import('@react-pdf/renderer');
    const element = React.createElement(AnalysisPdf, {
      siteLabel: site.label,
      brand: franchisor?.brandName ?? null,
      location: site.city ?? null,
      dateStr,
      confidence: `${summary.label} · evidence ${coverageConfidence}`,
      narrative: summaryToText(summary),
      schemaText: `Modules included: ${modulesIncluded}.`,
      checkWarning: null,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = await renderToBuffer(element as any);

    const safe = site.label.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '') || 'site';
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
