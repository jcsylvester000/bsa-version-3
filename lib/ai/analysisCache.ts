/**
 * Pure rules for the per-site Analysis cache/lock row (module_result, module='analysis').
 * No I/O — shared by lib/ai/analysisReport.ts and unit-tested in isolation.
 *
 *   payload.status = 'ready'      → finished report (legacy rows: no status + `analysis` string)
 *   payload.status = 'generating' → a generation holds the lock (lockId + startedAt)
 *   payload.status = 'failed'     → the last attempt failed (reason + failedAt); the poller stops
 *                                    and surfaces the reason instead of waiting out the lock TTL.
 */

/**
 * A claim older than this is treated as abandoned (the function/instance was killed mid-call) and
 * can be taken over. 5 min covers the async (Netlify Background Function) path: the generation runs
 * off-request and a slow VectorShift run can exceed the old 90s, during which the poller must keep
 * seeing 'generating', not 'missing'. A genuine crash short-circuits sooner via the 'failed' state,
 * so this longer TTL only affects the rare truly-stuck job.
 */
export const LOCK_TTL_MS = 300_000;

export type AnalysisPayload = Record<string, unknown>;

export function isReadyPayload(p: AnalysisPayload | null | undefined): p is AnalysisPayload & { analysis: string } {
  return !!p && typeof p.analysis === 'string' && p.status !== 'generating' && p.status !== 'failed';
}

export function isFreshLock(p: AnalysisPayload | null | undefined, now: number = Date.now()): boolean {
  if (!p || p.status !== 'generating') return false;
  const t = Date.parse(String(p.startedAt ?? ''));
  return Number.isFinite(t) && now - t < LOCK_TTL_MS;
}

/** A recorded failure of the last attempt (so the poller can stop and surface the reason). */
export function isFailedPayload(p: AnalysisPayload | null | undefined): p is AnalysisPayload & { reason: string } {
  return !!p && p.status === 'failed' && typeof p.reason === 'string';
}

/** The JSON field + value identifying THIS version of the row, for conditional (CAS) updates. */
export function versionToken(p: AnalysisPayload): { path: string[]; equals: string } | null {
  if (typeof p.lockId === 'string') return { path: ['lockId'], equals: p.lockId };
  if (typeof p.generatedAt === 'string') return { path: ['generatedAt'], equals: p.generatedAt };
  return null;
}
