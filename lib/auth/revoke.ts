/**
 * F-26: session revocation. Bumping `app_user.sessions_valid_after` to now invalidates every JWT
 * that was issued before this instant (getSession rejects them), so logout, a password change, or a
 * role/franchisor change take effect immediately instead of waiting out the 8-hour token.
 *
 * Call this whenever a user's sessions must be cut off. For the CURRENT device you usually re-issue a
 * fresh cookie right after (see the password route), so only OTHER sessions are logged out.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { isUuid } from '@/lib/util/uuid';

export async function revokeUserSessions(userId: string): Promise<void> {
  // Mock/demo accounts have non-UUID ids and no app_user row — nothing to revoke.
  if (!isUuid(userId)) return;
  await prisma.appUser.update({ where: { id: userId }, data: { sessionsValidAfter: new Date() } }).catch(() => undefined);
}
