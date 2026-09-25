/**
 * Central edge middleware (F-30). Two jobs, on every request:
 *
 *  1. A per-request CSP NONCE. Next 14's bootstrap needs inline scripts; without a nonce the only way
 *     to allow them is `'unsafe-inline'`, which also allows an injected <script> (XSS). Here each
 *     request gets a fresh nonce, `script-src` carries `'nonce-…' 'strict-dynamic'` and NO
 *     `'unsafe-inline'`, and Next applies the nonce to its own scripts. Bundled code (incl. maplibre,
 *     an npm import) loads via those nonced scripts, so the map still works. Styles keep
 *     `'unsafe-inline'` (maplibre/Tailwind inject inline styles); scripts are the real XSS vector.
 *
 *  2. A CENTRAL AUTH GUARD so a new route can't forget its own check. Unauthenticated requests to app
 *     pages redirect to /login; to APIs get a 401. This is a COARSE gate (JWT signature only) — each
 *     route's getSession() remains the fine-grained authority (roles, per-run ownership, F-26 revocation).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import { authSecret } from '@/lib/auth/secret';

const SESSION_COOKIE = 'bsa_session';

/** Paths that never require a session (the login page and the endpoints used to get one). */
const PUBLIC_PATHS = new Set<string>(['/login']);
const PUBLIC_API_PREFIXES = ['/api/auth/login', '/api/auth/register', '/api/client-error'];

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'));
}

/** Map tile origins the CSP must allow (mirrors the old next.config CSP). */
function tileOrigin(): string {
  const u = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  if (!u) return '';
  try {
    return new URL(u.replace(/\{s\}/g, 'a').replace(/\{[a-z]\}/g, '0')).origin.replace(/^(https?:\/\/)a\./, '$1*.');
  } catch { return ''; }
}

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== 'production';
  const tiles = ['https://*.basemaps.cartocdn.com', 'https://*.tile.openstreetmap.org', tileOrigin()].filter(Boolean).join(' ');
  return [
    "default-src 'self'",
    // Nonce + strict-dynamic, NO 'unsafe-inline' (F-30). 'unsafe-eval' stays dev-only (HMR).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${tiles}`,
    `connect-src 'self' ${tiles}${isDev ? ' ws: wss:' : ''}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(authSecret()));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // --- Auth guard (coarse) ---------------------------------------------------
  if (!isPublic(pathname)) {
    const authed = await hasValidSession(req);
    if (!authed) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ ok: false, error: { code: 'unauthorized', message: 'Authentication required.' } }, { status: 401 });
      }
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  // --- CSP nonce -------------------------------------------------------------
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const nonce = btoa(String.fromCharCode(...bytes));
  const csp = buildCsp(nonce);
  const reportOnly = process.env.BSA_CSP_REPORT_ONLY === '1';

  // Next reads the nonce from the request's CSP header and applies it to its inline scripts.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set(reportOnly ? 'content-security-policy-report-only' : 'content-security-policy', csp);
  return res;
}

export const config = {
  // Run on everything EXCEPT Next internals and static assets (no session/CSP work needed there).
  matcher: ['/((?!_next/static|_next/image|favicon.ico|brand/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)'],
};
