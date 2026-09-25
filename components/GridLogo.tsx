/**
 * GRID Property Ventures logo.
 *
 * Renders the official horizontal logo (three wave ribbons + "GRID / PROPERTY VENTURES"). Two variants:
 * - `/brand/grid-logo-dark.png` — transparent background + light wordmark, for the dark theme (default).
 * - `/brand/grid-logo.png` — the original navy wordmark, for the light theme.
 * Tailwind `darkMode` keys off `[data-theme="dark"]` on <html> (app/layout.tsx), so the pair swaps
 * with the theme and no JS is involved. Size it with the `className` height, e.g. "h-8".
 */
import * as React from 'react';

export function GridLogo({ className = '', alt = 'GRID Property Ventures' }: { className?: string; alt?: string }) {
  // Plain <img> (not next/image) — a small static brand asset, no optimization pipeline needed.
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/grid-logo-dark.png" alt={alt} className={`hidden dark:block ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/grid-logo.png" alt={alt} className={`block dark:hidden ${className}`} />
    </>
  );
}
