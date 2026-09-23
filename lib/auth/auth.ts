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
import { authSecret } from './secret';
import { isUuid } from '@/lib/util/uuid';

export type UserRole = 'admin' | 'analyst' | 'broker' | 'franchisor';

export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  franchisorId: string | null;
}

const SESSION_COOKIE = 'bsa_session';
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8h

// Secret policy (fail closed when deployed) lives in ./secret so session JWTs and signed
// storage URLs share one rule.
function secretKey(): Uint8Array {
  return new TextEncoder().encode(authSecret());
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

/** Grid staff (admin / analyst) — full oversight of every tenant. */
export function isStaff(user: SessionUser): boolean {
  return user.role === 'admin' || user.role === 'analyst';
}

/** Platform administrator — the only role allowed to run cross-tenant maintenance. */
export function isAdmin(user: SessionUser): boolean {
  return user.role === 'admin';
}

/**
 * Brand visibility — who may SEE a franchisor (in lists, templates, and as an intake target).
 *  - staff → every brand;
 *  - the user's own attached franchisor;
 *  - a brand the user created (independent business, or a brand added from the intake);
 *  - SHARED catalog brands: no owning user AND no creator (the seeded reference catalog).
 * A brand created by another user, or owned by another client, is never visible.
 */
export function canSeeFranchisor(
  user: SessionUser,
  f: { id: string; createdByUserId: string | null; ownerCount: number },
): boolean {
  if (isStaff(user)) return true;
  if (user.franchisorId != null && user.franchisorId === f.id) return true;
  if (f.createdByUserId != null) return f.createdByUserId === user.id;
  return f.ownerCount === 0;
}

/** Prisma `where` fragment matching exactly the franchisors `canSeeFranchisor` allows. */
export function visibleFranchisorWhere(user: SessionUser) {
  if (isStaff(user)) return {};
  return {
    OR: [
      { users: { none: {} }, createdByUserId: null }, // shared catalog
      // brands this user created (demo accounts have non-UUID ids and never create brands)
      ...(isUuid(user.id) ? [{ createdByUserId: user.id }] : []),
      ...(user.franchisorId ? [{ id: user.franchisorId }] : []), // their own client brand
    ],
  };
}

/** Roles allowed to run/write analyses (not read-only viewers). */
export function canRunPipeline(user: SessionUser): boolean {
  return ['admin', 'analyst', 'franchisor', 'broker'].includes(user.role);
}
