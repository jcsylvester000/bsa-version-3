import { SESSION_COOKIE_NAME } from '@/lib/auth/auth';
import { getSession } from '@/lib/auth/session';
import { revokeUserSessions } from '@/lib/auth/revoke';
import { ok } from '@/lib/api/respond';

export async function POST() {
  // F-26: revoke every session for this user (all devices), not just clear the cookie on this one,
  // so "log out" is immediate and complete. Best-effort — clearing the cookie still logs out here.
  const session = await getSession();
  if (session) await revokeUserSessions(session.id);

  const res = ok({ loggedOut: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return res;
}
