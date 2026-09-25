/**
 * Security headers (applied to every route, pages + API).
 *
 * CSP notes — the browser only ever talks to:
 *  - 'self' (pages, /api/*, /api/maptiles Google proxy, /api/files signed downloads)
 *  - CARTO / OSM raster basemap tiles (maplibre fetches + draws them) and an optional
 *    NEXT_PUBLIC_MAP_TILE_URL override (its origin is added automatically)
 *  - Google Fonts (globals.css @import)
 * maplibre spins its worker from a blob: URL → worker-src blob:.
 * Next 14 injects inline bootstrap scripts, so script-src needs 'unsafe-inline' until a
 * nonce-based CSP is added (dev-team hardening item). 'unsafe-eval' is dev-only (HMR).
 *
 * Escape hatch: BSA_CSP_REPORT_ONLY=1 sends the CSP as Report-Only (browser logs
 * violations instead of blocking) — use it if a new third-party host is introduced.
 */
const isDev = process.env.NODE_ENV !== 'production';

function tileOrigin() {
  const u = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  if (!u) return '';
  try {
    // Template URLs like https://{s}.tile.example.com/{z}/{x}/{y}.png → wildcard the {s}.
    return new URL(u.replace(/\{s\}/g, 'a').replace(/\{[a-z]\}/g, '0')).origin.replace(/^(https?:\/\/)a\./, '$1*.');
  } catch {
    return '';
  }
}

const tiles = ['https://*.basemaps.cartocdn.com', 'https://*.tile.openstreetmap.org', tileOrigin()]
  .filter(Boolean)
  .join(' ');

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src 'self' data: blob: https://images.unsplash.com ${tiles}`,
  `connect-src 'self' ${tiles}${isDev ? ' ws: wss:' : ''}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// NOTE (F-30): the Content-Security-Policy is now emitted by middleware.ts, which adds a per-request
// nonce so script-src no longer needs 'unsafe-inline'. It is intentionally NOT set here — two CSP
// headers would combine and the static one (without the nonce) would break Next's inline scripts.
// The `csp` string above is kept only as documentation of the non-nonce baseline.
void csp;
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

// Build id shown in the app so you can confirm which build is live (audit F-50). Netlify sets
// COMMIT_REF at build time; bake the short SHA into the client bundle as NEXT_PUBLIC_BUILD_ID.
const buildId = (process.env.COMMIT_REF || process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'dev';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_BUILD_ID: buildId },
  // Prisma is a server-only dependency; keep it external so it is never bundled to the client.
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs', '@react-pdf/renderer'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
