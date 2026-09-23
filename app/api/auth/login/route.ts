import { NextRequest } from 'next/server';
import { verifyPassword, signSession, SESSION_COOKIE_NAME, SESSION_MAX_AGE, type SessionUser } from '@/lib/auth/auth';
import { isMockAuth, verifyMockLogin } from '@/lib/auth/mockUsers';
import { loginSchema } from '@/lib/validation/schemas';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';

/** Normalise the login identifier the same way registration stores it. */
function accountKey(raw: string): string {
  const t = raw.trim().toLowerCase();
  return t.includes('@') ? t : `${t}@local`;
}

export async function POST(req: NextRequest) {
  // Top-level guard: this route ALWAYS returns JSON, never an empty 500.
  try {
    const body = await req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return failValidation(parsed.error);

    const invalid = () => fail({ code: 'invalid_credentials', message: 'Invalid email or password.' }, 401);
    const hasDb = !!process.env.DATABASE_URL;

    // --- Brute-force guard (DB-backed; skipped only in a no-database mock checkout) ------
    // Checked BEFORE any password comparison so a locked account/IP costs no bcrypt work.
    const account = accountKey(parsed.data.email);
    let ipKey = '';
    let rl: typeof import('@/lib/auth/rateLimit') | null = null;
    if (hasDb) {
      rl = await import('@/lib/auth/rateLimit');
      ipKey = rl.hashKey(rl.clientIp(req));
      const [acct, ip] = await Promise.all([
        rl.checkLimit('login_failed', 'auth_account', account, rl.LIMITS.loginPerAccount),
        rl.checkLimit('login_failed', 'auth_ip', ipKey, rl.LIMITS.loginPerIp),
      ]);
      if (acct.limited || ip.limited) {
        return errors.tooMany(
          Math.max(acct.retryAfterSeconds, ip.retryAfterSeconds),
          'Too many failed sign-in attempts. Please wait 15 minutes and try again.',
        );
      }
    }

    let sessionUser: SessionUser | null = null;

    // Try the mock demo accounts first (so the built-in test logins keep working),
    // then fall back to a real database user. isMockAuth() is always false on a
    // deployment unless BSA_ALLOW_DEMO_LOGINS=1 (see lib/auth/mockUsers.ts).
    if (isMockAuth()) {
      const mock = verifyMockLogin(parsed.data.email, parsed.data.password);
      if (mock) {
        sessionUser = { id: mock.id, email: mock.email, role: mock.role, franchisorId: mock.franchisorId };
      }
    }

    if (!sessionUser && hasDb) {
      // --- DB lookup: real registered user. ----------------------------------
      // Imported lazily so a pure-mock checkout with no DB never needs Prisma.
      try {
        const { prisma } = await import('@/lib/db/prisma');
        const { audit } = await import('@/lib/audit/audit');
        // Match registration's normalization: a bare username is stored as
        // "<username>@local". Try the input as typed first (real emails), then the
        // normalized bare-username form.
        const raw = parsed.data.email.trim().toLowerCase();
        const user =
          (await prisma.appUser.findUnique({ where: { email: raw } })) ??
          (account !== raw ? await prisma.appUser.findUnique({ where: { email: account } }) : null);
        if (user) {
          const good = await verifyPassword(parsed.data.password, user.passwordHash);
          if (good) {
            sessionUser = { id: user.id, email: user.email, role: user.role, franchisorId: user.franchisorId };
            await audit({ actorId: user.id, action: 'login', entity: 'app_user', entityId: user.id });
          }
        }
      } catch (dbErr) {
        console.error('[auth/login] db lookup failed', dbErr);
      }
    }

    if (!sessionUser) {
      // Record the failure against both the account and the (hashed) client IP.
      if (rl) {
        await Promise.all([
          rl.recordAttempt('login_failed', 'auth_account', account),
          rl.recordAttempt('login_failed', 'auth_ip', ipKey),
        ]);
      }
      return invalid();
    }

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
