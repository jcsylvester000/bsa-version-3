import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { errors } from '@/lib/api/respond';
import { composeReport } from '@/lib/modules/reportComposer';
import { buildScorecardsForRun } from '@/lib/modules/scorecardServer';
import { renderReportHtml, type ReportClientDetails } from '@/lib/modules/reportHtml';
import { audit } from '@/lib/audit/audit';

/**
 * GET /api/reports/full?runId=…&ownerName=…&company=…&contactNumber=…&preparedFor=…&email=…
 *
 * Returns a COMPLETE, self-contained, branded HTML report for the run — cover page (with
 * the client details), the 9 structured sections, per-site scorecards, and the Truth-Layer
 * confidence read. The client opens it in a new tab and prints/saves to PDF. Client details
 * arrive as query params (collected by the modal); nothing is persisted server-side.
 *
 * Served as text/html (not JSON) so the browser renders it directly.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });

  const runId = req.nextUrl.searchParams.get('runId');
  if (!runId || !isUuid(runId)) return new Response('Run not found', { status: 404 });

  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } }, _count: { select: { sites: true } } },
  });
  if (!run) return new Response('Run not found', { status: 404 });
  if (!canAccessRun(session, run)) return new Response('Forbidden', { status: 403 });

  const q = req.nextUrl.searchParams;
  const client: ReportClientDetails = {
    ownerName: q.get('ownerName') ?? undefined,
    company: q.get('company') ?? undefined,
    contactNumber: q.get('contactNumber') ?? undefined,
    preparedFor: q.get('preparedFor') ?? undefined,
    email: q.get('email') ?? undefined,
  };

  const [composed, scorecards] = await Promise.all([composeReport(run.id), buildScorecardsForRun(run.id)]);

  const html = renderReportHtml(composed, scorecards, client, {
    generatedAtISO: new Date().toISOString(),
    runVertical: run.vertical,
    siteCount: run._count.sites,
  });

  await audit({
    actorId: session.id,
    action: 'download_full_report',
    entity: 'report',
    entityId: run.id,
    meta: { runId: run.id, hasClientDetails: !!(client.ownerName || client.company || client.preparedFor) },
  });

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
