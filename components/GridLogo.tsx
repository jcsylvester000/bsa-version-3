/**
 * GRID Property Ventures logo.
 *
 * Renders the official horizontal logo (three wave ribbons + "GRID / PROPERTY VENTURES"). We ship a
 * dark-theme version at /brand/grid-logo-dark.png — the supplied artwork has a white background and a
 * navy wordmark, so it was processed to a transparent background with a light wordmark that reads on
 * the dark navy UI (the tan waves are unchanged). Size it with the `className` height, e.g. "h-8".
 */
import * as React from 'react';

export function GridLogo({ className, alt = 'GRID Property Ventures' }: { className?: string; alt?: string }) {
  // Plain <img> (not next/image) — a small static brand asset, no optimization pipeline needed.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/grid-logo-dark.png" alt={alt} className={className} />;
}
