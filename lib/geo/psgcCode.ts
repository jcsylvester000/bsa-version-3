/**
 * PSGC code helpers (Brief alignment T-3). PSA codes are 10 digits ("0402101006" — Cavite). The
 * boundary maps (faeldon/philippines-json-maps) store codes as JSON numbers and name their files
 * with them, so the leading zero is lost ("402101006"). BSA stores the 10-digit form everywhere so
 * census files, boundaries and places join by code; file names use the integer form.
 * Pure — unit-tested in tests/unit/psgcCode.test.ts.
 */

/** Any code (number or text, with or without "PH"/separators) → digits, or null. A 9-digit code that
 *  does NOT start with 0 is a 10-digit code that lost its leading zero ("402101006") and is padded.
 *  A 9-digit code starting with 0 is the pre-2019 PSGC scheme ("042101001") and is kept as written. */
export function psgc10(raw: string | number | null | undefined): string | null {
  if (raw == null) return null;
  const digits = typeof raw === 'number'
    ? (Number.isFinite(raw) ? String(Math.trunc(raw)) : '')
    : `${raw}`.replace(/[^0-9]/g, '');
  if (!digits) return null;
  return digits.length === 9 && digits[0] !== '0' ? digits.padStart(10, '0') : digits;
}

/** The integer form the boundary-map file names use ("0402100000" → "402100000"). */
export function psgcFileCode(raw: string | number): string {
  const d = psgc10(raw) ?? `${raw}`;
  return String(Number(d));
}
