import { NextRequest } from 'next/server';
import { verifyPassword, signSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE, type SessionUser } from '@/lib/auth/auth';
import { isMockAuth, verifyMockLogin } from '@/lib/auth/mockUsers';
import { loginSchema } from '@/lib/validation/schemas';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';

export async function POST(req: NextRequest) {
  // Top-level guard: this route ALWAYS returns JSON, never an empty 500.
  try {
    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const invalid = () => fail({ code: 'invalid_credentials', message: 'Invalid email or password.' }, 401);

    let sessionUser: SessionUser | null = null;

    // Try the mock demo accounts first (so the built-in test logins keep working),
    // then fall back to a real database user. This means registered accounts can sign
    // in even while AUTH_MODE=mock is set — the demo logins and real users coexist.
    if (isMockAuth()) {
      const mock = verifyMockLogin(parsed.data.email, parsed.data.password);
      if (mock) {
        sessionUser = { id: mock.id, email: mock.email, role: mock.role, franchisorId: mock.franchisorId };
      }
    }

    if (!sessionUser) {
      // --- DB lookup: real registered user. ----------------------------------
      // Imported lazily so a pure-mock checkout with no DB never needs Prisma.
      try {
        const { prisma } = await import('@/lib/db/prisma');
        const { audit } = await import('@/lib/audit/audit');
        // Match registration's normalization: a bare username is stored as
        // "<username>@local", so a user who registered with just "jsmith" must be able to
        // sign back in with "jsmith" (not only "jsmith@local"). Try the input as typed
        // first (real emails), then the normalized bare-username form.
        const raw = parsed.data.email.trim();
        const normalized = raw.includes('@') ? raw.toLowerCase() : `${raw.toLowerCase()}@local`;
        const user =
          (await prisma.appUser.findUnique({ where: { email: raw.toLowerCase() } })) ??
          (normalized !== raw.toLowerCase()
            ? await prisma.appUser.findUnique({ where: { email: normalized } })
            : null);
        if (user) {
          const good = await verifyPassword(parsed.data.password, user.passwordHash);
          if (good) {
            sessionUser = { id: user.id, email: user.email, role: user.role, franchisorId: user.franchisorId };
            await audit({ actorId: user.id, action: 'login', entity: 'app_user', entityId: user.id });
          }
        }
      } catch (dbErr) {
        // In pure-mock mode with no reachable DB, a failed mock login just means bad
        // credentials — don't surface a 500.
        console.error('[auth/login] db lookup failed', dbErr);
      }
    }

    if (!sessionUser) return invalid();

    const token = await signSession(sessionUser);
    const res = ok({ user: sessionUser, mock: isMockAuth() });
    res.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE,
    });
    return res;
  } catch (err) {
    console.error('[auth/login] unexpected error', err);
    return errors.server('Login failed. Check the server configuration (AUTH_SECRET / database).');
  }
}
