/**
 * Batch 1 security hardening — brand privacy, role guards, demo-login lockdown on
 * deployments, and the fail-closed signing secret.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { canSeeFranchisor, visibleFranchisorWhere, isAdmin, isStaff, type SessionUser } from '@/lib/auth/auth';
import { isMockAuth, verifyMockLogin, MOCK_PASSWORD } from '@/lib/auth/mockUsers';
import { authSecret, isDeployed } from '@/lib/auth/secret';

const U1 = '00000000-0000-4000-8000-000000000001';
const U2 = '00000000-0000-4000-8000-000000000002';
const BRAND_A = '00000000-0000-4000-8000-00000000000a';

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: U1, email: 'u1@local', role: 'franchisor', franchisorId: null, ...over,
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('canSeeFranchisor (brand privacy)', () => {
  const catalog = { id: BRAND_A, createdByUserId: null, ownerCount: 0 };
  it('shared catalog brand is visible to any user', () => {
    expect(canSeeFranchisor(user(), catalog)).toBe(true);
  });
  it("another user's independent business is NOT visible", () => {
    expect(canSeeFranchisor(user(), { ...catalog, createdByUserId: U2 })).toBe(false);
  });
  it('the creator sees their own brand', () => {
    expect(canSeeFranchisor(user(), { ...catalog, createdByUserId: U1 })).toBe(true);
  });
  it("a client-owned brand is hidden from other users but visible to its owner", () => {
    const owned = { ...catalog, ownerCount: 1 };
    expect(canSeeFranchisor(user(), owned)).toBe(false);
    expect(canSeeFranchisor(user({ franchisorId: BRAND_A }), owned)).toBe(true);
  });
  it('staff see everything', () => {
    const priv = { ...catalog, createdByUserId: U2, ownerCount: 3 };
    expect(canSeeFranchisor(user({ role: 'admin' }), priv)).toBe(true);
    expect(canSeeFranchisor(user({ role: 'analyst' }), priv)).toBe(true);
  });
});

describe('visibleFranchisorWhere', () => {
  it('is unrestricted for staff', () => {
    expect(visibleFranchisorWhere(user({ role: 'admin' }))).toEqual({});
  });
  it('restricts a normal user to catalog + created + own', () => {
    const w = visibleFranchisorWhere(user({ franchisorId: BRAND_A })) as { OR: unknown[] };
    expect(w.OR).toEqual([
      { users: { none: {} }, createdByUserId: null },
      { createdByUserId: U1 },
      { id: BRAND_A },
    ]);
  });
  it('never puts a non-UUID demo id into a UUID column filter', () => {
    const w = visibleFranchisorWhere(user({ id: 'mock-broker' })) as { OR: unknown[] };
    expect(JSON.stringify(w)).not.toContain('mock-broker');
  });
});

describe('role guards', () => {
  it('isAdmin / isStaff', () => {
    expect(isAdmin(user({ role: 'admin' }))).toBe(true);
    expect(isAdmin(user({ role: 'analyst' }))).toBe(false);
    expect(isStaff(user({ role: 'analyst' }))).toBe(true);
    expect(isStaff(user({ role: 'broker' }))).toBe(false);
    expect(isStaff(user({ role: 'franchisor' }))).toBe(false);
  });
});

describe('demo logins on a deployment', () => {
  it('are off on Netlify even with AUTH_MODE=mock', () => {
    vi.stubEnv('NETLIFY', 'true');
    vi.stubEnv('AUTH_MODE', 'mock');
    expect(isMockAuth()).toBe(false);
  });
  it('can be opted in, but staff demo accounts stay disabled', () => {
    vi.stubEnv('NETLIFY', 'true');
    vi.stubEnv('AUTH_MODE', 'mock');
    vi.stubEnv('BSA_ALLOW_DEMO_LOGINS', '1');
    expect(isMockAuth()).toBe(true);
    expect(verifyMockLogin('admin@grid.test', MOCK_PASSWORD)).toBeNull();
    expect(verifyMockLogin('analyst@grid.test', MOCK_PASSWORD)).toBeNull();
    expect(verifyMockLogin('broker@grid.test', MOCK_PASSWORD)?.role).toBe('broker');
  });
  it('still work locally', () => {
    vi.stubEnv('NETLIFY', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('BSA_REQUIRE_SECRET', '');
    vi.stubEnv('AUTH_MODE', 'mock');
    expect(isMockAuth()).toBe(true);
    expect(verifyMockLogin('admin@grid.test', MOCK_PASSWORD)?.role).toBe('admin');
  });
});

describe('signing secret fails closed when deployed', () => {
  it('throws on Netlify without AUTH_SECRET', () => {
    vi.stubEnv('NETLIFY', 'true');
    vi.stubEnv('AUTH_SECRET', '');
    expect(isDeployed()).toBe(true);
    expect(() => authSecret()).toThrow(/AUTH_SECRET/);
  });
  it('throws on a too-short secret when deployed', () => {
    vi.stubEnv('BSA_REQUIRE_SECRET', '1');
    vi.stubEnv('AUTH_SECRET', 'short');
    expect(() => authSecret()).toThrow();
  });
  it('uses the real secret when set', () => {
    vi.stubEnv('NETLIFY', 'true');
    vi.stubEnv('AUTH_SECRET', 'x'.repeat(48));
    expect(authSecret()).toBe('x'.repeat(48));
  });
  it('falls back only locally', () => {
    vi.stubEnv('NETLIFY', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('BSA_REQUIRE_SECRET', '');
    vi.stubEnv('AUTH_SECRET', '');
    expect(authSecret()).toMatch(/LOCAL_ONLY/);
  });
});
