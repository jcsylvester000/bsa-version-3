/**
 * Pure rules for the per-site Analysis cache/lock row (module_result, module='analysis').
 * No I/O — shared by lib/ai/analysisReport.ts and unit-tested in isolation.
 *
 *   payload.status = 'ready'      → finished report (legacy rows: no status + `analysis` string)
 *   payload.status = 'generating' → a generation holds the lock (lockId + startedAt)
 */

/** A claim older than this is treated as abandoned (the function was killed mid-call). */
export const LOCK_TTL_MS = 90_000;

export type AnalysisPayload = Record<string, unknown>;

export function isReadyPayload(p: AnalysisPayload | null | undefined): p is AnalysisPayload & { analysis: string } {
  return !!p && typeof p.analysis === 'string' && p.status !== 'generating';
}

export function isFreshLock(p: AnalysisPayload | null | undefined, now: number = Date.now()): boolean {
  if (!p || p.status !== 'generating') return false;
  const t = Date.parse(String(p.startedAt ?? ''));
  return Number.isFinite(t) && now - t < LOCK_TTL_MS;
}

/** The JSON field + value identifying THIS version of the row, for conditional (CAS) updates. */
export function versionToken(p: AnalysisPayload): { path: string[]; equals: string } | null {
  if (typeof p.lockId === 'string') return { path: ['lockId'], equals: p.lockId };
  if (typeof p.generatedAt === 'string') return { path: ['generatedAt'], equals: p.generatedAt };
  return null;
}
