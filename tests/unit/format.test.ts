/**
 * Deterministic number formatting — the anti-hydration-drift helper (React #418/#423).
 */
import { describe, it, expect } from 'vitest';
import { fmtInt, fmtPeso } from '@/lib/util/format';

describe('fmtInt', () => {
  it('groups thousands deterministically, regardless of runtime locale', () => {
    expect(fmtInt(1234567)).toBe('1,234,567');
    expect(fmtInt(0)).toBe('0');
    expect(fmtInt(999)).toBe('999');
    expect(fmtInt(1000)).toBe('1,000');
    expect(fmtInt(-4200)).toBe('-4,200');
    expect(fmtInt(1450.6)).toBe('1,451'); // rounds
    expect(fmtInt(null)).toBe('0');
    expect(fmtInt(undefined)).toBe('0');
    expect(fmtInt(NaN)).toBe('0');
  });
});

describe('fmtPeso', () => {
  it('prefixes ₱ and dashes null/NaN', () => {
    expect(fmtPeso(1234)).toBe('₱1,234');
    expect(fmtPeso(0)).toBe('₱0');
    expect(fmtPeso(null)).toBe('—');
    expect(fmtPeso(NaN)).toBe('—');
  });
});
