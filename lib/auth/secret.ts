/**
 * Server secret + deployment detection — the single source of truth for the signing
 * secret used by session JWTs (lib/auth/auth.ts) and signed storage URLs
 * (lib/storage/signtoken.ts). Server-only.
 *
 * Policy (fail CLOSED on a real deployment):
 *  - On a deployed environment (Netlify / Vercel, or BSA_REQUIRE_SECRET=1) a missing or
 *    short AUTH_SECRET is a hard error. There is NO silent fallback in production, so a
 *    misconfigured deploy can never sign tokens with a secret that is public in the repo.
 *  - Locally (plain `next dev`, or `next build && next start` on a laptop) a dev fallback
 *    is used with a one-time warning so a bare checkout still runs.
 */
import 'server-only';

/** True when running on a real hosted deployment rather than a developer machine. */
export function isDeployed(): boolean {
  return (
    process.env.BSA_REQUIRE_SECRET === '1' ||
    process.env.NETLIFY === 'true' ||
    process.env.VERCEL === '1'
  );
}

const MIN_SECRET_LENGTH = 32;
const DEV_FALLBACK_SECRET = 'bsa_dev_fallback_secret_LOCAL_ONLY_never_valid_when_deployed';

let warned = false;

/** The raw signing secret. Throws on a deployment without a proper AUTH_SECRET. */
export function authSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (s && s.length >= MIN_SECRET_LENGTH) return s;
  if (isDeployed()) {
    throw new Error(`AUTH_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters. Refusing to run a deployment with an insecure fallback.`);
  }
  if (!warned) {
    console.warn('[auth] AUTH_SECRET not set — using a LOCAL-ONLY dev fallback. This is refused on any deployment.');
    warned = true;
  }
  return DEV_FALLBACK_SECRET;
}
