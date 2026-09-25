/**
 * F-28 / F-29 security hardening: trusted client-IP header and fail-closed rate limiting.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));
const count = vi.fn();
vi.mock('@/lib/db/prisma', () => ({ prisma: { auditLog: { count: (...a: unknown[]) => count(...a) } } }));
vi.mock('@/lib/audit/audit', () => ({ audit: vi.fn() }));

import { clientIp, checkLimit, LIMITS } from '@/lib/auth/rateLimit';

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) }) as never;

afterEach(() => {
  vi.unstubAllEnvs();
  count.mockReset();
});

describe('clientIp', () => {
  it('prefers the Netlify edge header', () => {
    expect(clientIp(req({ 'x-nf-client-connection-ip': '1.2.3.4', 'x-forwarded-for': '9.9.9.9' }))).toBe('1.2.3.4');
  });
  it('ignores spoofable x-forwarded-for on a hosted deployment', () => {
    vi.stubEnv('NETLIFY', 'true');
    expect(clientIp(req({ 'x-forwarded-for': '9.9.9.9' }))).toBe('unknown');
  });
  it('uses x-forwarded-for locally', () => {
    vi.stubEnv('NETLIFY', '');
    vi.stubEnv('BSA_REQUIRE_SECRET', '');
    expect(clientIp(req({ 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }))).toBe('9.9.9.9');
  });
});

describe('checkLimit', () => {
  it('limits at the max', async () => {
    count.mockResolvedValue(LIMITS.passwordChangePerAccount.max);
    expect((await checkLimit('password_change_failed', 'auth_account', 'u', LIMITS.passwordChangePerAccount)).limited).toBe(true);
  });
  it('allows under the max', async () => {
    count.mockResolvedValue(1);
    expect((await checkLimit('login_failed', 'auth_account', 'u', LIMITS.loginPerAccount)).limited).toBe(false);
  });
  it('fails closed when the count cannot be read', async () => {
    count.mockRejectedValue(new Error('fetch failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await checkLimit('login_failed', 'auth_ip', 'k', LIMITS.loginPerIp)).limited).toBe(true);
  });
});
