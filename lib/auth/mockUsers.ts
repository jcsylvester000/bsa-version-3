/**
 * Mock authentication — lets you into the app with NO database.
 *
 * Enabled when AUTH_MODE=mock (or when AUTH_MODE is unset AND no DATABASE_URL is
 * configured — i.e. a fresh checkout with no .env still lets you look inside).
 * The four demo accounts below accept the shared demo password. This is a
 * development convenience only; production must run AUTH_MODE=db with real users.
 */
import type { UserRole } from './auth';

export interface MockUser {
  id: string;
  email: string;
  role: UserRole;
  franchisorId: string | null;
}

/** Shared demo password for every mock account. */
export const MOCK_PASSWORD = 'bsa-demo-1234';

/** Same franchisor id the seed uses, so mock login lines up with seeded data if present. */
const DEMO_FRANCHISOR_ID = '11111111-1111-1111-1111-111111111111';

export const MOCK_USERS: MockUser[] = [
  { id: 'mock-admin', email: 'admin@grid.test', role: 'admin', franchisorId: null },
  { id: 'mock-analyst', email: 'analyst@grid.test', role: 'analyst', franchisorId: null },
  { id: 'mock-broker', email: 'broker@grid.test', role: 'broker', franchisorId: DEMO_FRANCHISOR_ID },
  { id: 'mock-owner', email: 'owner@macaoimperial.test', role: 'franchisor', franchisorId: DEMO_FRANCHISOR_ID },
];

/** True when the app should authenticate against the mock users instead of the DB. */
export function isMockAuth(): boolean {
  const mode = process.env.AUTH_MODE;
  if (mode === 'mock') return true;
  if (mode === 'db') return false;
  // Unset: default to mock only when there's no database configured, so a bare
  // checkout is browsable but a configured install uses real auth.
  return !process.env.DATABASE_URL;
}

/** Find a mock user by email (case-insensitive) and check the shared password. */
export function verifyMockLogin(email: string, password: string): MockUser | null {
  if (password !== MOCK_PASSWORD) return null;
  const target = email.trim().toLowerCase();
  return MOCK_USERS.find((u) => u.email.toLowerCase() === target) ?? null;
}

/** The set of mock demo-user ids (stable, non-UUID). */
const MOCK_USER_IDS = new Set(MOCK_USERS.map((u) => u.id));

/**
 * True only when THIS SESSION belongs to a built-in demo account. Real registered users
 * always have a UUID id that isn't in this set. Use this — NOT the global `isMockAuth()`
 * env flag — to decide whether to show demo/sample data: a fresh registered account must
 * start empty even while AUTH_MODE=mock keeps the demo logins available.
 */
export function isMockUser(session: { id: string } | null | undefined): boolean {
  return !!session && MOCK_USER_IDS.has(session.id);
}
