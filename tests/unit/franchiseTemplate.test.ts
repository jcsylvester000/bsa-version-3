import { describe, it, expect } from 'vitest';
import { prefillFromRequirements, parseMinSqm } from '@/lib/modules/franchiseTemplate';
import { FOOTPRINT, EXPANSION_GOAL } from '@/lib/modules/intakeOptions';

describe('parseMinSqm', () => {
  it('takes the smallest sqm from a range', () => {
    expect(parseMinSqm('Pop-up 15–30 sqm / Inline 50–80 sqm')).toBe(15);
    expect(parseMinSqm('220–280 sqm (frontage 13m)')).toBe(220);
    expect(parseMinSqm('4 sqm')).toBe(4);
  });
  it('returns null when no sqm present', () => {
    expect(parseMinSqm('Master-franchise only')).toBeNull();
    expect(parseMinSqm(null)).toBeNull();
  });
});

describe('prefillFromRequirements', () => {
  it('maps a small kiosk footprint and carries real economics into section d', () => {
    const p = prefillFromRequirements({
      brand: 'Potato Corner', category: 'Food Cart and Kiosk', vertical: 'fnb_qsr',
      franchiseFee: '₱100,000–150,000', totalInvestment: '₱145,600–431,200', minSpace: '4 sqm',
      roiPayback: '1–2 yrs', staffing: '2–3 per cart', truthLayer: 'Verified',
    });
    expect(p.c).toBe(FOOTPRINT[0].value); // under 40 sqm
    expect(p.d).toContain('Fee');
    expect(p.d).toContain('Investment');
    expect(p.d).toContain('Verified');
    expect(p.a).toContain('Potato Corner');
    expect(p.e).toBe(EXPANSION_GOAL[0].value); // pilot
    expect(p.k).toContain('Consent given');
  });

  it('maps a large-format brand to a larger footprint', () => {
    const p = prefillFromRequirements({ brand: 'Mang Inasal', vertical: 'fnb_qsr', minSpace: '220–280 sqm' });
    expect(p.c).toBe(FOOTPRINT[3].value); // 150+ sqm
  });

  it('fills sensible vertical defaults (target customer, income, site pref)', () => {
    const p = prefillFromRequirements({ brand: 'Chatime', vertical: 'fnb_cafe', minSpace: 'Inline 50–80 sqm' });
    expect(p.b).toBeTruthy();
    expect(p.b2).toBeTruthy();
    expect(p.f).toBeTruthy();
    expect(p.c).toBe(FOOTPRINT[1].value); // 40–80 sqm
  });

  it('omits economics when the brand states none', () => {
    const p = prefillFromRequirements({ brand: 'X', vertical: 'other' });
    expect(p.d).toBeUndefined();
  });
});
