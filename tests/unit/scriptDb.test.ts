/** Bulk-loader reconnect guard: only connection-level failures are retried (never data errors). */
import { describe, it, expect } from 'vitest';
import { isConnectionError } from '../../prisma/scriptDb';

describe('isConnectionError', () => {
  it('retries Neon idle/suspend terminations and dropped sockets', () => {
    expect(isConnectionError({ message: 'Error { kind: Db, cause: ... code: SqlState(E57P01), message: "terminating connection due to administrator command" }' })).toBe(true);
    expect(isConnectionError({ code: 'P1017', message: 'Server has closed the connection.' })).toBe(true);
    expect(isConnectionError({ code: 'P1001', message: "Can't reach database server" })).toBe(true);
    expect(isConnectionError(new Error('read ECONNRESET'))).toBe(true);
  });
  it('does not retry data or constraint errors', () => {
    expect(isConnectionError({ code: 'P2002', message: 'Unique constraint failed' })).toBe(false);
    expect(isConnectionError({ code: 'P2010', message: 'Raw query failed. Code: 42703' })).toBe(false);
    expect(isConnectionError(null)).toBe(false);
  });
});
