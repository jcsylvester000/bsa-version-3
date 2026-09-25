/**
 * Read the current session from the request cookie. Used by route handlers and
 * server components to gate access. Returns null when unauthenticated.
 */
import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/db/prisma';
import { isUuid } from '@/lib/util/uuid';
import { verifySession, SESSION_COOKIE_NAME, type SessionUser } from './auth';
import { isTokenRevoked } from './sessionRevocation';

/**
 * F-26: authoritative per-user check against the DB — is this token still valid, and what is the
 * user's CURRENT role/franchisor? Deduped per request with React cache() so many getSession() calls
 * in one render cost a single query. Returns null when the user is gone or the token was revoked.
 */
const liveUser = cache(async (id: string, iat: number | undefined): Promise<Pick<SessionUser, 'role' | 'franchisorId'> | null> => {
  const u = await prisma.appUser.findUnique({ where: { id }, select: { role: true, franchisorId: true, sessionsValidAfter: true } });
  if (!u) return null; // user deleted → session invalid
  if (isTokenRevoked(iat, u.sessionsValidAfter)) return null; // logout / password change / role change
  return { role: u.role, franchisorId: u.franchisorId };
});

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const s = await verifySession(token);
  if (!s) return null;
  // Mock/demo accounts (non-UUID id) have no DB row — accept the signed token as-is.
  if (!isUuid(s.id)) return s;
  const live = await liveUser(s.id, s.iat);
  if (!live) return null;
  // Reflect the CURRENT role/franchisor from the DB so a change takes effect without re-login.
  return { ...s, role: live.role, franchisorId: live.franchisorId };
}

/** Throwing variant for route handlers that require a session. */
export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new UnauthorizedError();
  return s;
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Authentication required.');
    this.name = 'UnauthorizedError';
  }
}
