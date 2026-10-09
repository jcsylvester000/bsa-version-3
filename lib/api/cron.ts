import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/** Constant-time check of `Authorization: Bearer <CRON_SECRET>`. Fails closed when the secret is unset or short (< 32). */
export function cronAuthorized(header: string | null, secret = process.env.CRON_SECRET): boolean {
  if (!secret || secret.length < 32 || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
