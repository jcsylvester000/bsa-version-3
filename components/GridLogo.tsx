/**
 * GRID Property Ventures logo — theme-aware inline SVG.
 *
 * The brand mark is three wave ribbons (earth · water · wind) in the Muesli / Burly Wood tans.
 * Rendered as SVG (not the white-background PNG) so it sits cleanly on the dark navy UI and scales
 * crisply at any size. The wordmark uses the brand heading font (Cantata One) and inherits the
 * current text colour, so "GRID" is white on dark and navy on light without a second asset.
 *
 * `variant="mark"`  → just the waves (compact lockups, the sidebar chip, favicons).
 * `variant="full"`  → waves + "GRID" + "PROPERTY VENTURES" (login, print headers).
 */
import * as React from 'react';

/** The three-wave brand mark. Colour comes from the brand tans, independent of the surrounding text. */
export function GridMark({ className, title = 'Grid Property Ventures' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="-2 -4 68 60" className={className} role="img" aria-label={title} xmlns="http://www.w3.org/2000/svg">
      <title>{title}</title>
      <g fill="none" strokeLinecap="round" strokeWidth={7}>
        <path d="M3 11 C 14 3, 22 3, 32 11 C 42 19, 50 19, 61 11" stroke="#E2B985" />
        <path d="M3 26 C 14 18, 22 18, 32 26 C 42 34, 50 34, 61 26" stroke="#CE9A6E" />
        <path d="M3 41 C 14 33, 22 33, 32 41 C 42 49, 50 49, 61 41" stroke="#BE8562" />
      </g>
      {/* Dot accents echoing the brand mark. */}
      <g fill="#E2B985" opacity="0.9">
        <circle cx="7" cy="8" r="1.1" /><circle cx="10.5" cy="8" r="1.1" />
        <circle cx="7" cy="11.5" r="1.1" /><circle cx="10.5" cy="11.5" r="1.1" />
      </g>
    </svg>
  );
}

/**
 * Full horizontal lockup: the wave mark + the GRID wordmark. `subtitle` toggles the
 * "PROPERTY VENTURES" line. Text inherits `currentColor` (white on the dark UI).
 */
export function GridLogo({
  className,
  markClassName = 'h-10 w-auto',
  subtitle = true,
}: {
  className?: string;
  markClassName?: string;
  subtitle?: boolean;
}) {
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`}>
      <GridMark className={markClassName} />
      <div className="leading-none">
        <span className="font-heading text-2xl tracking-[0.14em] text-current">GRID</span>
        {subtitle && (
          <span className="mt-1 block text-[9px] font-medium uppercase tracking-[0.28em] text-current opacity-70">
            Property Ventures
          </span>
        )}
      </div>
    </div>
  );
}
