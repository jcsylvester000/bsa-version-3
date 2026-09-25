/**
 * Per-user daily quota for the paid Google API proxy routes (F-25). Reuses the DB-backed rate
 * limiter (audit_log sliding window), so no new table. Applied to /api/places and /api/geocode —
 * the expensive, low-volume calls. Map tiles are intentionally NOT metered here: they are
 * high-volume, cached, and metering each tile to Postgres would cost more than it saves — a tile
 * budget belongs at the edge/CDN, which the dev team can add later.
 *
 * A demo/mock session (non-UUID id) shares one bucket keyed by "demo".
 */
import 'server-only';
import type { NextRequest } from 'next/server';
import { checkLimit, recordAttempt, LIMITS, hashKey } from './rateLimit';
import { isUuid } from '@/lib/util/uuid';

export interface QuotaResult { allowed: boolean; retryAfterSeconds: number }

/** Check (and, when allowed, consume one unit of) a user's daily Google-API budget. */
export async function consumeGoogleQuota(userId: string): Promise<QuotaResult> {
  const key = isUuid(userId) ? userId : 'demo';
  const lim = await checkLimit('google_api_call', 'api_quota', key, LIMITS.googleApiPerUserDaily);
  if (lim.limited) return { allowed: false, retryAfterSeconds: lim.retryAfterSeconds };
  // Record the spend up-front so a failed upstream call still counts (blocks error-loop abuse).
  await recordAttempt('google_api_call', 'api_quota', key);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Convenience for routes that also want to bucket by client IP (unused today; kept for symmetry). */
export function clientKey(req: NextRequest): string {
  return hashKey(req.headers.get('x-nf-client-connection-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown');
}
