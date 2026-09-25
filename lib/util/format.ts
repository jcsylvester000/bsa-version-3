/**
 * Deterministic number formatting — identical on the server and in the browser.
 *
 * WHY THIS EXISTS: `Number.prototype.toLocaleString()` (no args) uses the *runtime's* default
 * locale. Next.js server-renders client components, so a number formatted during SSR (server
 * locale) is compared against the same number formatted during hydration (browser locale). When
 * the two locales group digits differently (e.g. server "1,234" vs a German browser "1.234"),
 * React throws hydration error #418/#423. These helpers group thousands with a fixed comma and
 * never touch ICU, so server and client always produce the same string.
 */

/** Integer with fixed comma grouping ("1,234,567"). Rounds; runtime-locale-independent. */
export function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '0';
  const neg = n < 0;
  const digits = Math.round(Math.abs(n)).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return neg ? `-${grouped}` : grouped;
}

/** Peso amount ("₱1,234"), or an em dash for null/NaN. Rounds to whole pesos. */
export function fmtPeso(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? '—' : `₱${fmtInt(n)}`;
}
