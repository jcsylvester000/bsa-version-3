/**
 * Intake completeness — the 80% must-have gate. Shared by the API (enforcement)
 * and the wizard (live meter) so the number the user sees matches the number the
 * server enforces.
 *
 * Sections A–K mirror the intake checklist. A section counts as "present" when it
 * has at least one non-empty value. The gate is 80% of the must-have sections.
 */
export const REQUIRED_SECTIONS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] as const;
export type SectionKey = (typeof REQUIRED_SECTIONS)[number];

/** Must-have sections (the 80% gate is computed against these). */
export const MUST_HAVE: SectionKey[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'k'];

export interface CompletenessResult {
  pct: number;
  present: SectionKey[];
  missing: SectionKey[];
}

function isPresent(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}

export function computeCompleteness(sections: Record<string, unknown>): CompletenessResult {
  const present: SectionKey[] = [];
  const missing: SectionKey[] = [];
  for (const key of MUST_HAVE) {
    if (isPresent(sections[key])) present.push(key);
    else missing.push(key);
  }
  const pct = Math.round((present.length / MUST_HAVE.length) * 100);
  return { pct, present, missing };
}
