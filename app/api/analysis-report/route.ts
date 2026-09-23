import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun, type SessionUser } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { generateAnalysisReport, readAnalysis, REGENERATE_CAP_PER_DAY } from '@/lib/ai/analysisReport';
import { AiGenerationError } from '@/lib/ai/vectorshiftProvider';

// One site's generation must fit in ONE function invocation. Netlify synchronous functions
// allow up to 26s (the provider timeout defaults to 24s to stay under it). Vercel honours this
// export directly; on Netlify, raise the site's function timeout to 26s if it is lower.
export const maxDuration = 26;
export const dynamic = 'force-dynamic';

/**
 * AI Analysis Report for ONE site of a run (retrieve-then-generate).
 *
 * GET  ?runId&siteId            → read-only status: { status: 'ready', report } |
 *                                  { status: 'generating', startedAt } | { status: 'missing' }.
 *                                  Never generates (safe to poll; never bills).
 * POST { runId, siteId, force? } → generate if missing (or regenerate with force).
 *                                  200 ready · 202 generating (another request holds the lock;
 *                                  poll GET) · 429 regenerate cap · 502 AI unavailable.
 *
 * Errors never include provider response bodies — details go to server logs only.
 */

const Body = z.object({
  runId: z.string().refine(isUuid, 'runId must be a UUID'),
  siteId: z.string().refine(isUuid, 'siteId must be a UUID'),
  force: z.boolean().optional(),
});

/** Session + run access + site-belongs-to-run. Returns an error response or null. */
async function guard(session: SessionUser, runId: string, siteId: string) {
  const run = await prisma.pipelineRun.findUnique({ where: { id: runId }, select: { createdByUserId: true, franchisorId: true } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();
  const site = await prisma.candidateSite.findUnique({ where: { id: siteId }, select: { pipelineRunId: true } });
  if (!site || site.pipelineRunId !== runId) return errors.notFound('Site');
  return null;
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  const runId = req.nextUrl.searchParams.get('runId') ?? '';
  const siteId = req.nextUrl.searchParams.get('siteId') ?? '';
  if (!isUuid(runId) || !isUuid(siteId)) return errors.notFound('Report');
  const denied = await guard(session, runId, siteId);
  if (denied) return denied;

  const s = await readAnalysis(siteId);
  if (s.state === 'ready') return ok({ status: 'ready', report: s.result });
  if (s.state === 'generating') return ok({ status: 'generating', startedAt: s.startedAt });
  return ok({ status: 'missing' });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error);
  const { runId, siteId, force } = parsed.data;
  const denied = await guard(session, runId, siteId);
  if (denied) return denied;

  try {
    const out = await generateAnalysisReport(runId, siteId, { force: force === true, actorId: session.id });
    if (out.status === 'ready') return ok({ status: 'ready', report: out.result });
    if (out.status === 'generating') return ok({ status: 'generating', startedAt: out.startedAt }, { status: 202 });
    return errors.tooMany(
      60 * 60,
      `This site's analysis has been regenerated ${REGENERATE_CAP_PER_DAY} times in the last 24 hours. Please try again later.`,
    );
  } catch (e) {
    // Details were already logged server-side by the generator. The client gets a generic
    // message plus a SHORT machine reason (e.g. timeout, http_401, db_migration_pending) —
    // never the provider's response body — so operators can diagnose from the browser.
    const reason = e instanceof AiGenerationError ? e.code : e instanceof Error && /AI_PROVIDER=/.test(e.message) ? 'config_ai_provider' : 'internal';
    if (e instanceof Error && /AI_PROVIDER=/.test(e.message)) console.error('[analysis-report]', e.message);
    const details = [{ path: 'reason', message: reason }];
    if (reason.startsWith('config_')) {
      return fail({ code: 'ai_not_configured', message: 'The AI analysis service is not configured. Please contact Grid support.', details }, 503);
    }
    if (reason === 'db_migration_pending') {
      return fail({ code: 'ai_unavailable', message: 'The analysis service needs a database update (prisma migrate deploy). Please contact Grid support.', details }, 503);
    }
    return fail(
      {
        code: 'ai_unavailable',
        message: reason === 'timeout'
          ? 'The AI analysis took too long to respond. Please try again in a minute.'
          : 'The AI analysis could not be generated right now. Please try again in a minute.',
        details,
      },
      502,
    );
  }
}
