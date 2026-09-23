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
} as const;

export function hashKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex').slice(0, 40);
}

/** Best-effort client IP. Netlify sets x-nf-client-connection-ip; else the first XFF hop. */
export function clientIp(req: NextRequest): string {
  const h = req.headers;
  return (
    h.get('x-nf-client-connection-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    h.get('x-real-ip') ??
    'unknown'
  );
}

/** How many `action` rows exist for (entity, key) inside the window. Fails OPEN (0) if
 *  the DB is unreachable — in that case the login itself cannot succeed anyway. */
async function countRecent(action: string, entity: string, key: string, windowMs: number): Promise<number> {
  try {
    return await prisma.auditLog.count({
      where: { action, entity, entityId: key, at: { gte: new Date(Date.now() - windowMs) } },
    });
  } catch (err) {
    console.error('[rateLimit] count failed', err);
    return 0;
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
  return { limited: n >= limit.max, retryAfterSeconds: Math.ceil(limit.windowMs / 1000) };
}

export async function recordAttempt(action: string, entity: string, key: string, meta?: Record<string, unknown>) {
  await audit({ action, entity, entityId: key, meta });
}
