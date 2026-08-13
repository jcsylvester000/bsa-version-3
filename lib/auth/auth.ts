/**
 * Auth — JWT (jose, HS256) + bcrypt password hashing. Server-only.
 *
 * Four roles (admin / analyst / broker / franchisor). Access is scoped so a
 * franchisor (or a broker acting for one) can only ever read their own
 * franchisor's data. The scoping helper below is imported by every data-access
 * path — the check lives at the boundary, not just in the UI.
 */
import 'server-only';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

export type UserRole = 'admin' | 'analyst' | 'broker' | 'franchisor';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  franchisorId: string | null;
}

const SESSION_COOKIE = 'bsa_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h

// A stable dev fallback so the app never hard-crashes locally when AUTH_SECRET is
// unset. In production a real 32+ byte AUTH_SECRET is required and this fallback is
// refused (see below).
const DEV_FALLBACK_SECRET = 'bsa_dev_fallback_secret_do_not_use_in_production_0123456789';

function secretKey(): Uint8Array {
  let s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    // Only hard-fail on a real deployment (explicit flag), not merely because a
    // local `next build` sets NODE_ENV=production. This lets you run the app
    // locally with no .env; production must set AUTH_SECRET and BSA_REQUIRE_SECRET=1.
    if (process.env.BSA_REQUIRE_SECRET === '1') {
      throw new Error('AUTH_SECRET is missing or too short (need 32+ bytes).');
    }
    if (!process.env.__BSA_WARNED_SECRET) {
      console.warn('[auth] AUTH_SECRET not set — using an insecure dev fallback. Set AUTH_SECRET (and BSA_REQUIRE_SECRET=1) before deploying.');
      process.env.__BSA_WARNED_SECRET = '1';
    }
    s = DEV_FALLBACK_SECRET;
  }
  return new TextEncoder().encode(s);
}

// --- passwords --------------------------------------------------------------
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

// --- tokens -----------------------------------------------------------------
export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, role: user.role, franchisorId: user.franchisorId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      email: String(payload.email ?? ''),
      role: payload.role as UserRole,
      franchisorId: (payload.franchisorId as string | null) ?? null,
    };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;

// --- access scoping ---------------------------------------------------------
/**
 * Can this session read/act on data belonging to `targetFranchisorId`?
 * - admin / analyst  → any franchisor (Grid staff)
 * - franchisor       → only their own franchisorId
 * - broker           → only the franchisor they are attached to
 * A broker cannot read another franchisor's outlet data — enforced here.
 */
export function canAccessFranchisor(user: SessionUser, targetFranchisorId: string): boolean {
  if (user.role === 'admin' || user.role === 'analyst') return true;
  return user.franchisorId != null && user.franchisorId === targetFranchisorId;
}

/**
 * @deprecated Do NOT use for run/report/module reads — it treats every shared-catalog
 * brand as public, which leaks one user's runs to another. Use `canAccessRun` instead,
 * which scopes by the run's creator. Retained only for any brand-level (non-run) check
 * that genuinely wants "is this a shared brand".
 *
 * Async access check that also permits SHARED catalog brands — franchisors with no
 * owning user (the reference brands anyone can analyse). Private client franchisors
 * (owned by a user) stay strictly scoped.
 */
export async function canAccessFranchisorShared(
  prisma: { franchisor: { findUnique: (a: { where: { id: string }; select: { _count: { select: { users: true } } } }) => Promise<{ _count: { users: number } } | null> } },
  user: SessionUser,
  targetFranchisorId: string,
): Promise<boolean> {
  if (canAccessFranchisor(user, targetFranchisorId)) return true;
  const f = await prisma.franchisor.findUnique({ where: { id: targetFranchisorId }, select: { _count: { select: { users: true } } } });
  return !!f && f._count.users === 0;
}

/**
 * Per-RUN access — the market-ready ownership boundary. A run (and everything hanging
 * off it: report, module results, AI generations, candidate sites) is private to the
 * user who created it. Access is granted when:
 *   - the user is staff (admin/analyst) — full oversight; OR
 *   - the user created the run (`createdByUserId === user.id`); OR
 *   - the run predates ownership (legacy `createdByUserId === null`) AND it targets a
 *     brand the user's own franchisor owns — so old client-brand runs still resolve.
 *
 * Note this deliberately does NOT treat "shared catalog brand" as public: two users
 * both analysing Jollibee each see only their OWN Jollibee run, never each other's.
 * That's the difference from `canAccessFranchisorShared`, which this replaces on every
 * run/report/module read path.
 */
export function canAccessRun(
  user: SessionUser,
  run: { createdByUserId: string | null; franchisorId: string },
): boolean {
  if (user.role === 'admin' || user.role === 'analyst') return true;
  if (run.createdByUserId != null) return run.createdByUserId === user.id;
  // Legacy run with no recorded owner: fall back to the strict brand check so a
  // franchisor/broker can still open their own historic client-brand runs.
  return user.franchisorId != null && user.franchisorId === run.franchisorId;
}

/** Roles allowed to run/write analyses (not read-only viewers). */
export function canRunPipeline(user: SessionUser): boolean {
  return ['admin', 'analyst', 'franchisor', 'broker'].includes(user.role);
}
