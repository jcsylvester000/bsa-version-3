/**
 * F-25: per-user daily Google-API quota.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const checkLimit = vi.fn();
const recordAttempt = vi.fn();
vi.mock('@/lib/auth/rateLimit', () => ({
  checkLimit: (...a: unknown[]) => checkLimit(...a),
  recordAttempt: (...a: unknown[]) => recordAttempt(...a),
  hashKey: (s: string) => s,
  LIMITS: { googleApiPerUserDaily: { max: 500, windowMs: 86_400_000 } },
}));

import { consumeGoogleQuota } from '@/lib/auth/apiQuota';

beforeEach(() => { checkLimit.mockReset(); recordAttempt.mockReset(); });

describe('consumeGoogleQuota', () => {
  it('allows and records a call under budget', async () => {
    checkLimit.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
    const r = await consumeGoogleQuota('11111111-1111-4111-8111-111111111111');
    expect(r.allowed).toBe(true);
    expect(recordAttempt).toHaveBeenCalledOnce();
  });
  it('blocks over budget without recording', async () => {
    checkLimit.mockResolvedValue({ limited: true, retryAfterSeconds: 3600 });
    const r = await consumeGoogleQuota('11111111-1111-4111-8111-111111111111');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSeconds).toBe(3600);
    expect(recordAttempt).not.toHaveBeenCalled();
  });
  it('buckets demo/mock users together under "demo"', async () => {
    checkLimit.mockResolvedValue({ limited: false, retryAfterSeconds: 0 });
    await consumeGoogleQuota('mock-admin');
    expect(checkLimit).toHaveBeenCalledWith('google_api_call', 'api_quota', 'demo', expect.anything());
  });
});
