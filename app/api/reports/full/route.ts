import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { composeReport } from '@/lib/modules/reportComposer';
import { buildScorecardsForRun } from '@/lib/modules/scorecardServer';
import { renderReportHtml, type ReportClientDetails } from '@/lib/modules/reportHtml';
import { audit } from '@/lib/audit/audit';

/**
 * The COMPLETE, self-contained, branded HTML Run Report (all sites) — cover page, the 9
 * structured sections, per-site scorecards, and the Truth-Layer confidence read. Opened in a
 * new tab; the user prints / saves to PDF. Built on demand from the database; nothing stored.
 *
 * POST (form-encoded: runId, ownerName, company, contactNumber, preparedFor, email) — the
 *      download modal submits the cover details in the request BODY, so client names and
 *      phone numbers never appear in URLs, browser history or server/CDN logs.
 * GET  ?runId=… — the same report without cover details.
 *
 * Served as text/html (not JSON) so the browser renders it directly.
 */
export async function GET(req: NextRequest) {
  return renderFull(req.nextUrl.searchParams.get('runId'), {});
}

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null);
  const field = (k: string) => {
    const v = form?.get(k);
    return typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined;
  };
  return renderFull(field('runId') ?? null, {
    ownerName: field('ownerName'),
    company: field('company'),
    contactNumber: field('contactNumber'),
    preparedFor: field('preparedFor'),
    email: field('email'),
  });
}

async function renderFull(runId: string | null, client: ReportClientDetails): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (!runId || !isUuid(runId)) return new Response('Run not found', { status: 404 });

  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } }, _count: { select: { sites: true } } },
  });
  if (!run) return new Response('Run not found', { status: 404 });
  if (!canAccessRun(session, run)) return new Response('Forbidden', { status: 403 });

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
