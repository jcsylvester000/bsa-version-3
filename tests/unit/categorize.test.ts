import { describe, it, expect } from 'vitest';
import { categorizeByName, exploreCategories } from '@/lib/places/competitorRelevance';

describe('categorizeByName (Explore)', () => {
  it('classifies real establishment names into the right category', () => {
    expect(categorizeByName('Chatime BGC').key).toBe('milk_tea');
    expect(categorizeByName('Starbucks Bonifacio High Street').key).toBe('coffee');
    expect(categorizeByName('% Arabica Manila BGC Roastery').key).toBe('coffee');
    expect(categorizeByName('Jollibee Taguig').key).toBe('qsr');
    expect(categorizeByName("McDonald's Taguig").key).toBe('qsr');
    expect(categorizeByName('Mang Inasal Cubao').key).toBe('grilled_qsr');
    expect(categorizeByName('7-Eleven Parkwest').key).toBe('convenience');
    expect(categorizeByName('Mercury Drug Makati').key).toBe('pharmacy');
    expect(categorizeByName('Petron JP Laurel').key).toBe('fuel');
    expect(categorizeByName('Cebuana Lhuillier').key).toBe('remittance');
    expect(categorizeByName('Anytime Fitness BGC').key).toBe('fitness');
  });

  it('prefers the more specific category (milk tea before coffee)', () => {
    // A tea brand that also contains a generic word should still land in milk_tea.
    expect(categorizeByName('Gong Cha Ortigas').key).toBe('milk_tea');
  });

  it('falls back to "other" for unclassifiable names', () => {
    expect(categorizeByName('Dr. Wine BGC').key).toBe('other');
    expect(categorizeByName('').key).toBe('other');
  });

  it('exposes a non-empty ordered category list ending in other', () => {
    const cats = exploreCategories();
    expect(cats.length).toBeGreaterThan(10);
    expect(cats[cats.length - 1].key).toBe('other');
  });
});
