import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { hashPassword, verifyPassword } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { changePasswordSchema } from '@/lib/validation/schemas';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { audit } from '@/lib/audit/audit';

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

  const body = await req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  const user = await prisma.appUser.findUnique({ where: { id: session.id }, select: { id: true, passwordHash: true } });
  if (!user) return errors.notFound('Account');

  const okCurrent = await verifyPassword(currentPassword, user.passwordHash);
  if (!okCurrent) return fail({ code: 'wrong_password', message: 'Your current password is incorrect.' }, 403);

  // Reject a no-op change so the user gets clear feedback instead of a silent success.
  const sameAsOld = await verifyPassword(newPassword, user.passwordHash);
  if (sameAsOld) return fail({ code: 'password_unchanged', message: 'The new password must be different from the current one.' }, 422);

  await prisma.appUser.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(newPassword) } });
  await audit({ actorId: user.id, action: 'change_password', entity: 'app_user', entityId: user.id });

  return ok({ changed: true });
}
