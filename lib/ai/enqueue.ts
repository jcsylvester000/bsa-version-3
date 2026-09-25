/**
 * Enqueue an Analysis Report job onto the Netlify Background Function.
 *
 * WHY: a live VectorShift run can take longer than a synchronous serverless function is allowed to
 * live (Netlify sync functions cap at 26s), which surfaced as `timeout` 502s under load. A Netlify
 * *Background Function* (a file named `*-background`) runs asynchronously for up to 15 minutes and
 * returns 202 immediately. So the POST route CLAIMS the lock, hands the job here, and returns
 * `generating`; the browser then polls the read-only status endpoint until the job writes `ready`.
 *
 * Safe rollout: this is OFF unless `ANALYSIS_BACKGROUND=1`. With it off (or on the stub provider),
 * the POST route generates inline exactly as before — so a not-yet-deployed function never breaks the
 * app. `INTERNAL_JOB_SECRET` authenticates the invocation so the function can't be triggered by an
 * outsider to run (and bill) generation.
 */
import 'server-only';

export interface AnalysisJobMessage {
  runId: string;
  siteId: string;
  which: 'stub' | 'vectorshift';
  trigger: 'initial' | 'regenerate';
  lockId: string;
  actorId?: string;
  restore: Record<string, unknown> | null;
}

/** True when the async background path is enabled (env flag on). */
export function analysisAsyncEnabled(): boolean {
  return process.env.ANALYSIS_BACKGROUND === '1';
}

/** Base URL Netlify exposes for the running site (set automatically in the build/runtime env). */
function siteBaseUrl(): string {
  return (process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.NETLIFY_URL || '').replace(/\/$/, '');
}

/**
 * Fire the job at the background function and wait only for its 202 accept (fast). Returns true when
 * accepted, false otherwise — the caller falls back to inline generation on false so nothing is lost.
 */
export async function enqueueAnalysisJob(msg: AnalysisJobMessage): Promise<boolean> {
  const base = siteBaseUrl();
  if (!base) { console.error('[analysis] enqueue skipped — no site URL in env (URL/DEPLOY_PRIME_URL).'); return false; }
  const secret = process.env.INTERNAL_JOB_SECRET;
  if (!secret) { console.error('[analysis] enqueue skipped — INTERNAL_JOB_SECRET not set.'); return false; }

  const url = `${base}/.netlify/functions/analysis-report-background`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-bsa-job-secret': secret },
      body: JSON.stringify(msg),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));
    // Netlify background functions answer 202 as soon as the job is accepted.
    if (res.status === 202 || res.ok) return true;
    console.error(`[analysis] enqueue rejected (${res.status}) at ${url}`);
    return false;
  } catch (e) {
    console.error('[analysis] enqueue failed:', (e as Error)?.message ?? e);
    return false;
  }
}
