/**
 * Brute-force protection for the auth endpoints. Server-only.
 *
 * Why DB-backed: on Netlify every request may land on a different function instance, so
 * an in-memory counter would reset constantly. Instead attempts are recorded as rows in
 * `audit_log` (which also satisfies the Section K governance requirement to log failed
 * logins) and counted over a sliding window using the existing (entity, entity_id) index.
 * No new table, no Redis. The dev team can swap this for an edge/KV limiter later without
 * touching the routes (same two functions).
 *
 * Keys are SHA-256 hashed so the audit log never stores raw client IPs.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { audit } from '@/lib/audit/audit';

export const LIMITS = {
  /** Failed logins for one account. */
  loginPerAccount: { max: 5, windowMs: 15 * 60_000 },
  /** Failed logins from one client IP (password spraying across accounts). */
  loginPerIp: { max: 20, windowMs: 15 * 60_000 },
  /** Account creations from one client IP. */
  registerPerIp: { max: 5, windowMs: 60 * 60_000 },
  /** Wrong current-password attempts on the change-password route, per signed-in account (F-28). */
  passwordChangePerAccount: { max: 5, windowMs: 15 * 60_000 },
  /** F-25: paid Google Places / Geocoding calls per user per day (the expensive, low-volume ones). */
  googleApiPerUserDaily: { max: 500, windowMs: 24 * 60 * 60_000 },
} as const;

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

/** True on a hosted deployment, where only the platform's own client-IP header is trustworthy. */
function isHosted(): boolean {
  return process.env.NETLIFY === 'true' || process.env.BSA_REQUIRE_SECRET === '1';
}

/**
 * Client IP for rate-limit keys (F-29). On Netlify only `x-nf-client-connection-ip` is trusted —
 * it is set by the edge and cannot be spoofed by the caller, whereas `x-forwarded-for` is
 * client-controlled and would let an attacker rotate keys freely. Off-platform (local dev) we fall
 * back to the forwarding headers. Unknown clients share one bucket, which is the safe direction.
 */
export function clientIp(req: NextRequest): string {
  const h = req.headers;
  const nf = h.get('x-nf-client-connection-ip');
  if (nf) return nf;
  if (isHosted()) return 'unknown';
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown';
}

/** How many `action` rows exist for (entity, key) inside the window, or null when the count
 *  could not be read (DB unreachable). */
async function countRecent(action: string, entity: string, key: string, windowMs: number): Promise<number | null> {
  try {
    return await prisma.auditLog.count({
      where: { action, entity, entityId: key, at: { gte: new Date(Date.now() - windowMs) } },
    });
  } catch (err) {
    console.error('[rateLimit] count failed', err);
    return null;
  }
}

export interface LimitCheck {
  limited: boolean;
  retryAfterSeconds: number;
}

export async function checkLimit(
  action: string,
  entity: string,
  key: string,
  limit: { max: number; windowMs: number },
): Promise<LimitCheck> {
  const n = await countRecent(action, entity, key, limit.windowMs);
  // F-29: fail CLOSED — if attempts can't be counted, refuse rather than allow unlimited tries.
  if (n === null) return { limited: true, retryAfterSeconds: 60 };
  return { limited: n >= limit.max, retryAfterSeconds: Math.ceil(limit.windowMs / 1000) };
}

export async function recordAttempt(action: string, entity: string, key: string, meta?: Record<string, unknown>) {
  await audit({ action, entity, entityId: key, meta });
}
