import { describe, it, expect } from 'vitest';
import { DEMO_SCENARIOS } from '@/lib/mock/demoData';
import {
  TARGET_CUSTOMER, INCOME_BAND, FOOTPRINT, EXPANSION_GOAL, SITE_PREFERENCE, CONSENT,
} from '@/lib/modules/intakeOptions';

const valueSet = (opts: { value: string }[]) => new Set(opts.map((o) => o.value));
// Section keys that are dropdowns → must be an exact option value or the select is blank.
const DROPDOWN_FIELDS: Record<string, Set<string>> = {
  b: valueSet(TARGET_CUSTOMER),
  b2: valueSet(INCOME_BAND),
  c: valueSet(FOOTPRINT),
  e: valueSet(EXPANSION_GOAL),
  f: valueSet(SITE_PREFERENCE),
  k: valueSet(CONSENT),
};
// All fields "Load demo data" must fill (a and d are free-text).
const REQUIRED_FIELDS = ['a', 'b', 'b2', 'c', 'd', 'e', 'f', 'k'];

describe('DEMO_SCENARIOS — prefill completeness', () => {
  it('provides exactly 6 unique, data-backed scenarios (incl. 1 independent)', () => {
    expect(DEMO_SCENARIOS).toHaveLength(6);
    const keys = new Set(DEMO_SCENARIOS.map((s) => s.key));
    expect(keys.size).toBe(6);
    // Exactly one independent (non-franchise) scenario, with its comparable brand set.
    const indie = DEMO_SCENARIOS.filter((s) => s.independent);
    expect(indie).toHaveLength(1);
    expect(indie[0].independent!.comparableBrand.length).toBeGreaterThan(0);
    expect(indie[0].independent!.name.length).toBeGreaterThan(0);
  });

  it('every scenario has at least one existing outlet and one candidate', () => {
    for (const s of DEMO_SCENARIOS) {
      expect(s.candidates.length).toBeGreaterThan(0);
      // territory needs outlets to measure overlap against
      expect(s.outlets.length).toBeGreaterThan(0);
    }
  });

  for (const s of DEMO_SCENARIOS) {
    describe(`scenario "${s.key}" (${s.brandName})`, () => {
      it('fills every required intake field', () => {
        for (const f of REQUIRED_FIELDS) {
          expect(s.sections[f], `section ${f} must be filled`).toBeTruthy();
          expect(s.sections[f].trim().length).toBeGreaterThan(0);
        }
      });
      it('uses exact dropdown option values (so no select renders blank)', () => {
        for (const [f, set] of Object.entries(DROPDOWN_FIELDS)) {
          const v = s.sections[f];
          expect(set.has(v), `section ${f}="${v}" must match an option value`).toBe(true);
        }
      });
      it('has real outlets and candidates with coordinates', () => {
        expect(s.outlets.length).toBeGreaterThan(0);
        expect(s.candidates.length).toBeGreaterThan(0);
        for (const o of s.outlets) {
          expect(o.outletName).toBeTruthy();
          expect(Number(o.lat)).toBeGreaterThan(4);
          expect(Number(o.lon)).toBeGreaterThan(116);
        }
        for (const c of s.candidates) {
          expect(c.label).toBeTruthy();
          expect(Number(c.lat)).toBeGreaterThan(4);
          expect(Number(c.lon)).toBeGreaterThan(116);
        }
      });
      it('has a metadata label, blurb and vertical', () => {
        expect(s.label).toBeTruthy();
        expect(s.blurb).toBeTruthy();
        expect(s.vertical).toBeTruthy();
      });
    });
  }
});
