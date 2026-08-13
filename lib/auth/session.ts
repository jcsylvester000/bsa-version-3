/**
 * Read the current session from the request cookie. Used by route handlers and
 * server components to gate access. Returns null when unauthenticated.
 */
import 'server-only';
import { cookies } from 'next/headers';
import { verifySession, SESSION_COOKIE_NAME, type SessionUser } from './auth';

export async function getSession(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySession(token);
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
