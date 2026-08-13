import { NextRequest } from 'next/server';
import { hashPassword, signSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE, type SessionUser } from '@/lib/auth/auth';
import { registerSchema } from '@/lib/validation/schemas';
import { ok, fail, failValidation } from '@/lib/api/respond';

/**
 * POST /api/auth/register — create a new user account (username + password) and sign
 * them in. New accounts are `franchisor` role with no attached brand: they analyse
 * shared catalog brands, add their own, or run independent businesses — the flow we
 * already built. A bare username is stored in the unique email column as
 * "<username>@local" so it remains a valid unique login key.
 *
 * Registration always writes to the database — the mock demo accounts are login-only.
 * As long as DATABASE_URL points at a reachable Postgres, this works regardless of
 * AUTH_MODE, so "Create account" is never blocked by the mock flag.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const { username, password } = parsed.data;
    const email = username.includes('@') ? username.toLowerCase() : `${username.toLowerCase()}@local`;

    const { prisma } = await import('@/lib/db/prisma');
    const { audit } = await import('@/lib/audit/audit');

    const existing = await prisma.appUser.findUnique({ where: { email } });
    if (existing) return fail({ code: 'username_taken', message: 'That username is already taken.' }, 409);

    // The findUnique check above has a race window: two concurrent registrations for the
    // same username can both pass it, then both call create(). The DB unique constraint
    // is the real guard — catch its violation (Prisma P2002) and return a clean 409
    // instead of letting it surface as a 500.
    let user;
    try {
      user = await prisma.appUser.create({
        data: {
          email,
          passwordHash: await hashPassword(password),
          role: 'franchisor',
          franchisorId: null,
          hasOnboarded: false, // triggers the first-run guided tour
        },
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'P2002') return fail({ code: 'username_taken', message: 'That username is already taken.' }, 409);
      throw e;
    }
    await audit({ actorId: user.id, action: 'register', entity: 'app_user', entityId: user.id });

    const sessionUser: SessionUser = { id: user.id, email: user.email, role: user.role, franchisorId: user.franchisorId };
    const token = await signSession(sessionUser);
    const res = ok({ user: sessionUser, registered: true }, { status: 201 });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch {
    return fail({ code: 'server_error', message: 'Could not create the account. Please try again.' }, 500);
  }
}
