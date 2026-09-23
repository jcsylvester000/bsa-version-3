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
  `img-src 'self' data: blob: ${tiles}`,
  `connect-src 'self' ${tiles}${isDev ? ' ws: wss:' : ''}`,
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const securityHeaders = [
  {
    key: process.env.BSA_CSP_REPORT_ONLY === '1' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
    value: csp,
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=()' },
  ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }]),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Prisma is a server-only dependency; keep it external so it is never bundled to the client.
  experimental: {
    serverComponentsExternalPackages: ['@prisma/client', 'bcryptjs', '@react-pdf/renderer'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
