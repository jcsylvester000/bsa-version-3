import { describe, it, expect } from 'vitest';
import { signKey, verifyKey } from '@/lib/storage/signtoken';

describe('signed storage tokens', () => {
  const key = 'reports/run-123/site-intelligence.md';
  const now = 1_700_000_000;

  it('verifies a fresh token', () => {
    const t = signKey(key, 300, now);
    expect(verifyKey(key, t.exp, t.sig, now)).toBe(true);
  });

  it('rejects an expired token', () => {
    const t = signKey(key, 300, now);
    expect(verifyKey(key, t.exp, t.sig, now + 301)).toBe(false);
  });

  it('rejects a tampered key', () => {
    const t = signKey(key, 300, now);
    expect(verifyKey('reports/other/site.md', t.exp, t.sig, now)).toBe(false);
  });

  it('rejects a tampered expiry', () => {
    const t = signKey(key, 300, now);
    expect(verifyKey(key, t.exp + 10_000, t.sig, now)).toBe(false);
  });

  it('rejects a garbage signature', () => {
    const t = signKey(key, 300, now);
    expect(verifyKey(key, t.exp, 'not-a-real-sig', now)).toBe(false);
  });
});
