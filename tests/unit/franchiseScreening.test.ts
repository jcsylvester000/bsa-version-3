import { describe, it, expect } from 'vitest';
import {
  parseInvestment, parsePayback, parseConfidence, scoreBrand, screenBrands, capitalTier,
} from '@/lib/modules/franchiseScreening';

describe('parseInvestment', () => {
  it('parses M/K ranges', () => {
    expect(parseInvestment('₱15M–35M (store-type dependent)')).toEqual({ min: 15_000_000, max: 35_000_000 });
    expect(parseInvestment('₱600K–6M')).toEqual({ min: 600_000, max: 6_000_000 });
    expect(parseInvestment('₱50,000–₱285,000')).toEqual({ min: 50_000, max: 285_000 });
  });
  it('parses a single amount', () => {
    expect(parseInvestment('₱1.2M system enrollment (VAT-excl.)')).toEqual({ min: 1_200_000, max: 1_200_000 });
  });
  it('ignores bare small numbers (frontage, not pesos)', () => {
    // "13m frontage" style content shouldn't be read as ₱13
    expect(parseInvestment('frontage 13m')?.min).not.toBe(13);
  });
  it('returns null when nothing parses', () => {
    expect(parseInvestment(null)).toBeNull();
    expect(parseInvestment('TBD')).toBeNull();
  });
});

describe('parsePayback', () => {
  it('parses year ranges and the estimate flag', () => {
    expect(parsePayback('4–5 yrs (est.)')).toEqual({ min: 4, max: 5, estimated: true });
    expect(parsePayback('Up to 10 yrs')).toEqual({ min: 10, max: 10, estimated: false });
    expect(parsePayback('~1.2 yrs')).toEqual({ min: 1.2, max: 1.2, estimated: true });
  });
  it('normalizes months to years', () => {
    expect(parsePayback('12–18 months')).toEqual({ min: 1, max: 1.5, estimated: false });
  });
  it('returns null when nothing parses', () => {
    expect(parsePayback('n/a')).toBeNull();
  });
});

describe('parseConfidence', () => {
  it('reads a percent', () => {
    expect(parseConfidence('95%')).toBe(95);
    expect(parseConfidence('80')).toBe(80);
    expect(parseConfidence(null)).toBeNull();
  });
});

describe('capitalTier', () => {
  it('bands by minimum investment', () => {
    expect(capitalTier(285_000)).toBe('entry');
    expect(capitalTier(2_000_000)).toBe('mid');
    expect(capitalTier(15_000_000)).toBe('institutional');
    expect(capitalTier(null)).toBeNull();
  });
});

describe('scoreBrand', () => {
  const cart = { brand: 'Potato Corner', requirements: { vertical: 'fnb_qsr', totalInvestment: '₱250K–450K', minSpace: '4–8 sqm', roiPayback: '~1.2 yrs', truthLayer: 'Verified', confidence: '90%' } };
  const bigQsr = { brand: 'Jollibee', requirements: { vertical: 'fnb_qsr', totalInvestment: '₱35M–55M', minSpace: '250–350 sqm', roiPayback: '4–5 yrs (est.)', truthLayer: 'Verified', confidence: '95%' } };

  it('rewards an affordable, space-fitting brand', () => {
    const s = scoreBrand(cart, { budgetPhp: 1_000_000, floorAreaSqm: 20, vertical: null });
    expect(s.overBudget).toBe(false);
    expect(s.overSpace).toBe(false);
    expect(s.fitScore).toBeGreaterThan(70);
  });
  it('flags and sinks a brand that is over budget', () => {
    const s = scoreBrand(bigQsr, { budgetPhp: 1_000_000, floorAreaSqm: 20, vertical: null });
    expect(s.overBudget).toBe(true);
    expect(s.overSpace).toBe(true);
    expect(s.fitScore).toBeLessThan(30);
  });
  it('carries the Truth Layer through', () => {
    const s = scoreBrand(cart, { budgetPhp: 1_000_000, floorAreaSqm: 20, vertical: null });
    expect(s.truthLayer).toBe('Verified');
    expect(s.confidence).toBe(90);
    expect(s.investment).toEqual({ min: 250_000, max: 450_000 });
  });
});

describe('screenBrands', () => {
  const brands = [
    { brand: 'Potato Corner', requirements: { vertical: 'fnb_qsr', totalInvestment: '₱250K–450K', minSpace: '4–8 sqm', roiPayback: '~1.2 yrs' } },
    { brand: 'Jollibee', requirements: { vertical: 'fnb_qsr', totalInvestment: '₱35M–55M', minSpace: '250–350 sqm', roiPayback: '4–5 yrs' } },
    { brand: 'Kumon', requirements: { vertical: 'education', totalInvestment: '₱1M–2M', minSpace: '60 sqm', roiPayback: '3 yrs' } },
  ];
  it('ranks the affordable, fitting brand first for a small buyer', () => {
    const ranked = screenBrands(brands, { budgetPhp: 800_000, floorAreaSqm: 30, vertical: null });
    expect(ranked[0].brand).toBe('Potato Corner');
    expect(ranked[ranked.length - 1].brand).toBe('Jollibee'); // over budget → last
  });
  it('applies the vertical filter', () => {
    const ranked = screenBrands(brands, { budgetPhp: 5_000_000, floorAreaSqm: 100, vertical: 'education' });
    expect(ranked.map((b) => b.brand)).toEqual(['Kumon']);
  });
});
