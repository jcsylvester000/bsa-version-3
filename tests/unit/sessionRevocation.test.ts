/**
 * F-26: token revocation cut-off, second-precision boundary.
 */
import { describe, it, expect } from 'vitest';
import { isTokenRevoked } from '@/lib/auth/sessionRevocation';

const at = (sec: number) => new Date(sec * 1000);

describe('isTokenRevoked', () => {
  it('never revokes when there is no cut-off', () => {
    expect(isTokenRevoked(1000, null)).toBe(false);
  });
  it('never revokes when iat is unknown', () => {
    expect(isTokenRevoked(undefined, at(1000))).toBe(false);
  });
  it('revokes a token issued before the cut-off second', () => {
    expect(isTokenRevoked(999, at(1000))).toBe(true);
  });
  it('keeps a token issued in the SAME second as the cut-off (current device re-issue)', () => {
    // cut-off at 1000.750s → floor = 1000; a token with iat 1000 must survive.
    expect(isTokenRevoked(1000, new Date(1000 * 1000 + 750))).toBe(false);
  });
  it('keeps a token issued after the cut-off', () => {
    expect(isTokenRevoked(1001, at(1000))).toBe(false);
  });
});
