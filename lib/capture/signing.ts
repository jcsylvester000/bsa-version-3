/**
 * Preview → save integrity (2026-10-07). The map preview is stateless: the server pulls places from
 * OpenStreetMap, returns them for display, and writes NOTHING. When the admin saves, the browser
 * sends the accepted places back. Each OSM place carries an HMAC "receipt" over the fields the server
 * fetched (element ref, name, tag, coordinates), keyed with the server secret. On save:
 *   valid receipt   → the place is exactly what OSM returned → Verified, may refresh a stored row;
 *   missing/broken  → edited or not from our pull → Assumed, and it never overwrites a stored place.
 * The category is not signed — re-categorising is a legitimate review edit.
 */
import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { authSecret } from '@/lib/auth/secret';

export interface SignedFields { osmRef: string; name: string; kind: string | null; lat: number; lon: number }

function payload(f: SignedFields): string {
  return ['capture/v1', f.osmRef, f.name, f.kind ?? '', f.lat.toFixed(7), f.lon.toFixed(7)].join('|');
}

export function signCandidate(f: SignedFields): string {
  return createHmac('sha256', authSecret()).update(payload(f)).digest('base64url').slice(0, 32);
}

export function verifyCandidate(f: SignedFields, sig: string | null | undefined): boolean {
  if (!sig || sig.length !== 32) return false;
  const expected = Buffer.from(signCandidate(f));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
