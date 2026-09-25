/**
 * Error monitoring seam (F-51). Server-side. ONE place every unexpected error is reported, with a
 * short reference id, a reason code, and the route — so production issues are found in a monitor,
 * not by users, and support can quote the reference.
 *
 * Today this is dependency-free: it always logs a structured line, and — when `ERROR_WEBHOOK_URL`
 * (or a Sentry-style DSN via `SENTRY_DSN`) is set — POSTs a compact JSON event to it. It is inert
 * (log-only) with no config, so nothing changes for a local run.
 *
 * SWAP TO SENTRY: `npm i @sentry/nextjs`, add sentry.server/client configs, and replace the body of
 * `captureException` with `Sentry.captureException(err, { tags: { code, route }, extra: { ref } })`.
 * The call sites (which pass ref/code/route) do not change. See docs/HANDOFF.md.
 */
import 'server-only';

export interface ErrorContext {
  /** Short id also shown to the user, so a report can be matched to a log line. */
  ref?: string;
  /** Machine-readable reason (e.g. 'intake_write_failed', 'pipeline_failed'). */
  code?: string;
  /** Route or operation where it happened. */
  route?: string;
}

/** Generate the short reference id shown to users and attached to the report. */
export function errorRef(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function captureException(err: unknown, ctx: ErrorContext = {}): Promise<void> {
  const ref = ctx.ref ?? errorRef();
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  // Always: a structured server log line (greppable, no user-facing internals).
  console.error(`[monitor] ref=${ref} code=${ctx.code ?? 'unhandled'} route=${ctx.route ?? '-'} :: ${message}`);

  const endpoint = process.env.ERROR_WEBHOOK_URL || process.env.SENTRY_DSN;
  if (!endpoint) return;
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref, code: ctx.code ?? 'unhandled', route: ctx.route ?? null, message, stack, at: new Date().toISOString() }),
      // Never let reporting block or throw into the request path.
      keepalive: true,
    });
  } catch {
    // Monitoring must never break the app.
  }
}
