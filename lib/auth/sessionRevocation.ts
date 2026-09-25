/**
 * Pure revocation check (F-26). A JWT `iat` is second-precision, so a token is revoked only when it
 * was issued STRICTLY BEFORE the cut-off SECOND. This lets the password route re-issue a fresh cookie
 * in the same second as the cut-off (keeping the current device signed in) while every earlier token
 * is rejected. No 'server-only'/Prisma import so it is unit-testable.
 */
export function isTokenRevoked(iatSeconds: number | undefined, sessionsValidAfter: Date | null): boolean {
  if (!sessionsValidAfter || iatSeconds == null) return false;
  return iatSeconds < Math.floor(sessionsValidAfter.getTime() / 1000);
}
