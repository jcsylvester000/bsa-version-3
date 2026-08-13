/**
 * Signed download tokens for the local-fs storage adapter. An HMAC over
 * (key + expiry) so a link is time-limited and tamper-evident — the local
 * equivalent of an S3/R2 presigned URL. Server-only; the secret never ships.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

const DEV_FALLBACK = 'bsa_dev_storage_signing_fallback_0123456789abcdef';

function signingSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.BSA_REQUIRE_SECRET === '1') {
    throw new Error('AUTH_SECRET required to sign storage URLs in production.');
  }
  return DEV_FALLBACK;
}

/** base64url without padding. */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface SignedToken {
  exp: number; // unix seconds
  sig: string;
}

export function signKey(key: string, expiresInSeconds: number, nowSeconds: number): SignedToken {
  const exp = nowSeconds + expiresInSeconds;
  const mac = createHmac('sha256', signingSecret()).update(`${key}:${exp}`).digest();
  return { exp, sig: b64url(mac) };
}

/** Verify a token for a key. Returns true only if the signature matches and not expired. */
export function verifyKey(key: string, exp: number, sig: string, nowSeconds: number): boolean {
  if (!Number.isFinite(exp) || exp < nowSeconds) return false;
  const expected = createHmac('sha256', signingSecret()).update(`${key}:${exp}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
