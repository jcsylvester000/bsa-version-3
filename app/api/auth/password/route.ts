import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { hashPassword, verifyPassword, signSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { changePasswordSchema } from '@/lib/validation/schemas';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { audit } from '@/lib/audit/audit';
import { checkLimit, recordAttempt, LIMITS } from '@/lib/auth/rateLimit';

/**
 * POST /api/auth/password — change the signed-in user's password. Verifies the current
 * password before writing the new hash, so a hijacked session still can't silently rotate
 * the credential. Demo/mock accounts have no DB row (and a non-UUID id), so they can't
 * change a password — they're login-only.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  if (isMockUser(session) || !isUuid(session.id)) {
    return fail(
      { code: 'demo_account_readonly', message: 'Demo accounts cannot change a password. Register a real account to manage credentials.' },
      403,
    );
  }

  // F-28: a stolen session must not be able to brute-force the current password here.
  const lim = await checkLimit('password_change_failed', 'auth_account', session.id, LIMITS.passwordChangePerAccount);
  if (lim.limited) {
    return errors.tooMany(lim.retryAfterSeconds, 'Too many incorrect attempts. Please wait 15 minutes and try again.');
  }

  const body = await req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.appUser.findUnique({ where: { id: session.id }, select: { id: true, passwordHash: true } });
  if (!user) return errors.notFound('Account');

  const okCurrent = await verifyPassword(currentPassword, user.passwordHash);
  if (!okCurrent) {
    await recordAttempt('password_change_failed', 'auth_account', user.id);
    return fail({ code: 'wrong_password', message: 'Your current password is incorrect.' }, 403);
  }

  // Reject a no-op change so the user gets clear feedback instead of a silent success.
  const sameAsOld = await verifyPassword(newPassword, user.passwordHash);
  if (sameAsOld) return fail({ code: 'password_unchanged', message: 'The new password must be different from the current one.' }, 422);

  // F-26: change the password AND cut off every session issued before now (a stolen token stops
  // working the moment the password changes). `sessions_valid_after = now` does the revocation.
  const cutoff = new Date();
  await prisma.appUser.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword), sessionsValidAfter: cutoff } });
  await audit({ actorId: user.id, action: 'change_password', entity: 'app_user', entityId: user.id });

  // Keep THIS device signed in: re-issue a fresh cookie (issued after the cutoff) so only the user's
  // OTHER sessions are logged out, not the one that just changed the password.
  const token = await signSession({ id: session.id, email: session.email, role: session.role, franchisorId: session.franchisorId });
  const res = ok({ changed: true });
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_MAX_AGE,
  });
  return res;
}
