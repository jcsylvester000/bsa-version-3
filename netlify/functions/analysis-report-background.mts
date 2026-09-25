/**
 * Netlify BACKGROUND FUNCTION — runs one Analysis Report job off-request.
 *
 * The `-background` filename suffix makes Netlify invoke this asynchronously: it answers 202 to the
 * caller immediately and then runs for up to 15 minutes. The POST /api/analysis-report route CLAIMS
 * the site's lock and enqueues the job here (see lib/ai/enqueue.ts); this function does the slow
 * VectorShift generation and writes the finished report to the DB, where the browser's poll picks it
 * up. Removing the 26s synchronous-function ceiling is the whole point — a slow live run no longer
 * 502s; it just takes a little longer and the poller waits.
 *
 * Security: only an invocation carrying the shared INTERNAL_JOB_SECRET is honoured, so no outsider
 * can trigger (and bill) generation. All the durable state + failure handling lives in
 * executeAnalysisReport — this file is just the async entrypoint, and it never throws.
 */
import { executeAnalysisReport } from '@/lib/ai/analysisReport';

export default async (req: Request): Promise<Response> => {
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret || req.headers.get('x-bsa-job-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  let body: Record<string, unknown> | null = null;
  try { body = (await req.json()) as Record<string, unknown>; } catch { /* handled below */ }
  const runId = body?.runId as string | undefined;
  const siteId = body?.siteId as string | undefined;
  const lockId = body?.lockId as string | undefined;
  const which = body?.which as 'stub' | 'vectorshift' | undefined;
  if (!runId || !siteId || !lockId || !which) return new Response('bad request', { status: 400 });

  try {
    const r = await executeAnalysisReport(runId, siteId, {
      which,
      trigger: (body?.trigger as 'initial' | 'regenerate') ?? 'initial',
      actorId: body?.actorId as string | undefined,
      lockId,
      restore: (body?.restore as Record<string, unknown> | null) ?? null,
    });
    console.log(`[analysis-bg] site=${siteId} → ${r.status}${r.status === 'failed' ? ` (${r.reason})` : ''}`);
  } catch (e) {
    // executeAnalysisReport already persists failures; this is a last-resort guard.
    console.error('[analysis-bg] unhandled:', (e as Error)?.message ?? e);
  }
  return new Response('accepted', { status: 202 });
};
