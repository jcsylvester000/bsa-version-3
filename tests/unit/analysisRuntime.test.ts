/**
 * Batch 2 — AI runtime: cache/lock rules for the per-site analysis row, and strict
 * AI_PROVIDER validation (no silent fallback to the stub).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { isReadyPayload, isFreshLock, isFailedPayload, versionToken, LOCK_TTL_MS } from '@/lib/ai/analysisCache';
import { aiProviderName } from '@/lib/ai/index';

afterEach(() => vi.unstubAllEnvs());

describe('analysis cache states', () => {
  it('a finished report is ready (new and legacy rows)', () => {
    expect(isReadyPayload({ status: 'ready', analysis: 'text' })).toBe(true);
    expect(isReadyPayload({ analysis: 'legacy text, no status' })).toBe(true);
  });
  it('a generating placeholder is not ready, even while keeping the previous text', () => {
    expect(isReadyPayload({ status: 'generating', analysis: 'old text', lockId: 'x' })).toBe(false);
    expect(isReadyPayload(null)).toBe(false);
    expect(isReadyPayload({ status: 'ready' })).toBe(false);
  });
  it('a failed marker is neither ready nor a fresh lock, and carries its reason (async path)', () => {
    const failed = { status: 'failed', reason: 'timeout', failedAt: new Date().toISOString() };
    expect(isFailedPayload(failed)).toBe(true);
    expect(isReadyPayload(failed)).toBe(false);
    expect(isFreshLock(failed)).toBe(false);
    expect(isFailedPayload({ status: 'ready', analysis: 'x' })).toBe(false);
    expect(isFailedPayload({ status: 'failed' })).toBe(false); // needs a reason string
  });
});

describe('generation lock freshness', () => {
  const now = Date.parse('2026-09-23T10:00:00Z');
  it('a recent claim is held', () => {
    const startedAt = new Date(now - 10_000).toISOString();
    expect(isFreshLock({ status: 'generating', startedAt }, now)).toBe(true);
  });
  it('an abandoned claim (function killed) can be taken over', () => {
    const startedAt = new Date(now - LOCK_TTL_MS - 1).toISOString();
    expect(isFreshLock({ status: 'generating', startedAt }, now)).toBe(false);
  });
  it('garbage timestamps never hold a lock forever', () => {
    expect(isFreshLock({ status: 'generating', startedAt: 'nope' }, now)).toBe(false);
    expect(isFreshLock({ status: 'ready', startedAt: new Date(now).toISOString() }, now)).toBe(false);
  });
});

describe('versionToken (conditional claim)', () => {
  it('prefers the lockId, then generatedAt, else none', () => {
    expect(versionToken({ lockId: 'L1', generatedAt: 'G' })).toEqual({ path: ['lockId'], equals: 'L1' });
    expect(versionToken({ generatedAt: 'G' })).toEqual({ path: ['generatedAt'], equals: 'G' });
    expect(versionToken({})).toBeNull();
  });
});

describe('AI_PROVIDER validation', () => {
  it('accepts stub (default) and vectorshift', () => {
    vi.stubEnv('AI_PROVIDER', '');
    expect(aiProviderName()).toBe('stub');
    vi.stubEnv('AI_PROVIDER', 'vectorshift');
    expect(aiProviderName()).toBe('vectorshift');
  });
  it('rejects a typo instead of silently using the stub', () => {
    vi.stubEnv('AI_PROVIDER', 'vectorshfit');
    expect(() => aiProviderName()).toThrow(/not supported/);
    vi.stubEnv('AI_PROVIDER', 'anthropic');
    expect(() => aiProviderName()).toThrow(/not supported/);
  });
});
