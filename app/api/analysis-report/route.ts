import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun, type SessionUser } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { claimAnalysisReport, executeAnalysisReport, readAnalysis, REGENERATE_CAP_PER_DAY } from '@/lib/ai/analysisReport';
import { analysisAsyncEnabled, enqueueAnalysisJob } from '@/lib/ai/enqueue';
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
  // A recorded failure stops the poller and shows the reason (never the provider body).
  if (s.state === 'failed') return ok({ status: 'error', reason: s.reason, message: failureMessage(s.reason) });
  return ok({ status: 'missing' });
}

/** Human message for a failure reason (mirrors the POST error mapping; never leaks provider detail). */
function failureMessage(reason: string): string {
  if (reason.startsWith('config_')) return 'The AI analysis service is not configured. Please contact Grid support.';
  if (reason === 'db_migration_pending') return 'The analysis service needs a database update. Please contact Grid support.';
  if (reason === 'timeout') return 'The AI analysis took too long to respond. Please try again in a minute.';
  return 'The AI analysis could not be generated right now. Please try again in a minute.';
}

/** Map a failure reason to the right HTTP response for the INLINE path. */
function failResponse(reason: string) {
  const details = [{ path: 'reason', message: reason }];
  if (reason.startsWith('config_')) return fail({ code: 'ai_not_configured', message: failureMessage(reason), details }, 503);
  if (reason === 'db_migration_pending') return fail({ code: 'ai_unavailable', message: failureMessage(reason), details }, 503);
  return fail({ code: 'ai_unavailable', message: failureMessage(reason), details }, 502);
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
    // 1) CLAIM (fast, no generation). Returns a cached report, an in-flight status, the cap, or
    //    'claimed' (we now own the lock and must run it).
    const claim = await claimAnalysisReport(runId, siteId, { force: force === true, actorId: session.id });
    if (claim.status === 'ready') return ok({ status: 'ready', report: claim.result });
    if (claim.status === 'generating') return ok({ status: 'generating', startedAt: claim.startedAt }, { status: 202 });
    if (claim.status === 'regenerate_limit') {
      return errors.tooMany(60 * 60, `This site's analysis has been regenerated ${REGENERATE_CAP_PER_DAY} times in the last 24 hours. Please try again later.`);
    }

    // 2) We hold the lock. On the live provider WITH async enabled, hand the slow work to the
    //    Netlify Background Function and return immediately — the browser polls GET until ready.
    if (claim.which === 'vectorshift' && analysisAsyncEnabled()) {
      const queued = await enqueueAnalysisJob({
        runId, siteId, which: claim.which, trigger: claim.trigger, lockId: claim.lockId,
        actorId: session.id, restore: claim.restore,
      });
      if (queued) return ok({ status: 'generating', startedAt: claim.startedAt }, { status: 202 });
      // Enqueue failed (misconfig / function down) → fall through to inline so nothing is lost.
      console.error('[analysis-report] background enqueue failed — running inline');
    }

    // 3) Inline execution (stub provider, async disabled, or enqueue fell back). This can hit the
    //    26s cap for a very slow live run — enable ANALYSIS_BACKGROUND to move it off-request.
    const run = await executeAnalysisReport(runId, siteId, {
      which: claim.which, trigger: claim.trigger, actorId: session.id, lockId: claim.lockId, restore: claim.restore,
    });
    if (run.status === 'ready') return ok({ status: 'ready', report: run.result });
    return failResponse(run.reason);
  } catch (e) {
    // claimAnalysisReport can throw only on an unsupported AI_PROVIDER (config) or a DB error.
    const reason = e instanceof AiGenerationError ? e.code : e instanceof Error && /AI_PROVIDER=/.test(e.message) ? 'config_ai_provider' : 'internal';
    if (e instanceof Error) console.error('[analysis-report]', e.message);
    return failResponse(reason);
  }
}
