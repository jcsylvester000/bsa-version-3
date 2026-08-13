import { describe, it, expect } from 'vitest';
import {
  conceptFor, isRelevantCompetitor, filterRelevantCompetitors, relevanceRatio, CONCEPTS,
} from '@/lib/places/competitorRelevance';

describe('conceptFor — vertical + concept text → concept', () => {
  it('milk-tea signal in a cafe brand → milk_tea concept', () => {
    expect(conceptFor('fnb_cafe', 'Macao Imperial Tea — milk tea').key).toBe('milk_tea');
    expect(conceptFor('fnb_cafe', 'Chatime bubble tea').key).toBe('milk_tea');
  });
  it('a cafe brand with no tea signal → coffee concept', () => {
    expect(conceptFor('fnb_cafe', 'Starbucks coffee').key).toBe('coffee');
    expect(conceptFor('fnb_cafe', '').key).toBe('coffee');
  });
  it('maps the non-F&B verticals', () => {
    expect(conceptFor('pharmacy').key).toBe('pharmacy');
    expect(conceptFor('fuel').key).toBe('fuel');
    expect(conceptFor('remittance').key).toBe('remittance');
    expect(conceptFor('services_fitness').key).toBe('fitness');
  });
  it('falls back to generic for an unknown vertical', () => {
    expect(conceptFor('spaceship').key).toBe('generic');
  });
});

describe('isRelevantCompetitor — the F&B separation', () => {
  const milk = CONCEPTS.milk_tea;
  const coffee = CONCEPTS.coffee;

  it('milk-tea concept KEEPS real milk-tea shops (by name or tea_house type)', () => {
    expect(isRelevantCompetitor({ name: 'Macao Imperial Tea One Ayala', primaryType: 'tea_house' }, milk)).toBe(true);
    expect(isRelevantCompetitor({ name: 'Serenitea', primaryType: 'cafe' }, milk)).toBe(true);
    expect(isRelevantCompetitor({ name: 'CHAGEE', primaryType: 'tea_store' }, milk)).toBe(true);
  });
  it('milk-tea concept REJECTS specialty coffee / donut / restaurant', () => {
    expect(isRelevantCompetitor({ name: 'Antipodean Coffee Roasters', primaryType: 'cafe' }, milk)).toBe(false);
    expect(isRelevantCompetitor({ name: 'Starbucks Reserve', primaryType: 'coffee_shop' }, milk)).toBe(false);
    expect(isRelevantCompetitor({ name: 'J.CO Donuts & Coffee', primaryType: 'donut_shop' }, milk)).toBe(false);
    expect(isRelevantCompetitor({ name: 'Green Bar', primaryType: 'vegan_restaurant' }, milk)).toBe(false);
  });
  it('coffee concept KEEPS coffee shops but REJECTS milk-tea', () => {
    expect(isRelevantCompetitor({ name: 'Starbucks - One Ayala', primaryType: 'coffee_shop' }, coffee)).toBe(true);
    expect(isRelevantCompetitor({ name: 'I Love Milk Tea BGC', primaryType: 'tea_house' }, coffee)).toBe(false);
  });
  it('QSR concept rejects fine dining', () => {
    const qsr = CONCEPTS.qsr;
    expect(isRelevantCompetitor({ name: 'Jollibee', primaryType: 'fast_food_restaurant' }, qsr)).toBe(true);
    expect(isRelevantCompetitor({ name: 'Some Omakase', primaryType: 'fine_dining_restaurant' }, qsr)).toBe(false);
  });
  it('unambiguous categories (pharmacy) count by type alone', () => {
    const ph = CONCEPTS.pharmacy;
    expect(isRelevantCompetitor({ name: 'Random Drugstore', primaryType: 'pharmacy' }, ph)).toBe(true);
  });
});

describe('QA v3 — new concepts', () => {
  it('Chinese-QSR: routes by name, keeps Chinese fast food, excludes burger QSR & fine dining', () => {
    const c = conceptFor('fnb_qsr', 'Chowking Chinese fast food');
    expect(c.key).toBe('chinese_qsr');
    expect(isRelevantCompetitor({ name: 'Panda Express', primaryType: 'chinese_restaurant' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: 'Chuan Kee Chinese Fast Food', primaryType: 'fast_food_restaurant' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: 'Some Omakase', primaryType: 'fine_dining_restaurant' }, c)).toBe(false);
  });
  it('casual dining: routes by name, keeps sit-down, excludes fast-food & cafes', () => {
    const c = conceptFor('fnb_qsr', "Max's Restaurant casual dining family restaurant");
    expect(c.key).toBe('casual_dining');
    expect(isRelevantCompetitor({ name: 'Tita Frieda’s', primaryType: 'family_restaurant' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: 'Jollibee', primaryType: 'fast_food_restaurant' }, c)).toBe(false);
    expect(isRelevantCompetitor({ name: 'Starbucks', primaryType: 'coffee_shop' }, c)).toBe(false);
  });
  it('plain QSR still routes to qsr (no chinese/casual signal)', () => {
    expect(conceptFor('fnb_qsr', 'Jollibee fried chicken').key).toBe('qsr');
  });
  it('water station: name-discriminated, keeps only water refilling', () => {
    const c = conceptFor('other', 'Aquabest water refilling station');
    expect(c.key).toBe('water');
    expect(isRelevantCompetitor({ name: 'Crystal Clear Water Station', primaryType: 'supplier' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: 'Some Hardware Store', primaryType: 'store' }, c)).toBe(false);
  });
  it('diagnostics: keeps clinics/labs by type', () => {
    const c = conceptFor('diagnostics');
    expect(isRelevantCompetitor({ name: 'QC Diagnostic Clinic', primaryType: 'medical_clinic' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: 'Sim Clinical Laboratory', primaryType: 'medical_lab' }, c)).toBe(true);
  });
  it('hotel: keeps hotels by type', () => {
    const c = conceptFor('hotel', 'Go Hotels budget');
    expect(isRelevantCompetitor({ name: 'Astrotel Cubao', primaryType: 'hotel' }, c)).toBe(true);
  });
});

describe('QA v4 — hard concepts', () => {
  it('automotive: keeps car_repair, excludes car wash', () => {
    const c = conceptFor('automotive', 'Rapide auto service');
    expect(c.key).toBe('automotive');
    expect(isRelevantCompetitor({ name: 'JIC Miller Auto Care', primaryType: 'car_repair' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: 'Shine Car Wash', primaryType: 'car_wash' }, c)).toBe(false);
  });
  it('grilled QSR: routes by name; keeps grilled chicken, drops burger/steak/mexican', () => {
    const c = conceptFor('fnb_qsr', 'Mang Inasal grilled chicken');
    expect(c.key).toBe('grilled_qsr');
    expect(isRelevantCompetitor({ name: 'Bacolod Chicken Parilla', primaryType: 'chicken_restaurant' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: "Peri-Peri Charcoal Chicken", primaryType: 'barbecue_restaurant' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: 'Texas Roadhouse', primaryType: 'steak_house' }, c)).toBe(false);
    expect(isRelevantCompetitor({ name: 'Jollibee', primaryType: 'fast_food_restaurant' }, c)).toBe(false); // burger QSR, no grill signal
  });
  it('nail salon: routes on nail signal; keeps nail salons, drops barber/massage', () => {
    const c = conceptFor('services_spa', 'Nail Spa nail manicure');
    expect(c.key).toBe('nail_salon');
    expect(isRelevantCompetitor({ name: 'Nailaholics', primaryType: 'nail_salon' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: "Bruno's Barbers", primaryType: 'barber_shop' }, c)).toBe(false);
  });
  it('bookstore: routes on book signal; keeps book_store, drops clothing store', () => {
    const c = conceptFor('retail_specialty', 'National Book Store bookstore');
    expect(c.key).toBe('bookstore');
    expect(isRelevantCompetitor({ name: 'Pandayan Bookshop', primaryType: 'store' }, c)).toBe(true);
    expect(isRelevantCompetitor({ name: 'A Shop', primaryType: 'clothing_store' }, c)).toBe(false);
  });
});

describe('filterRelevantCompetitors + relevanceRatio', () => {
  const milk = CONCEPTS.milk_tea;
  const list = [
    { name: 'Macao Imperial Tea', primaryType: 'tea_house' },
    { name: 'Serenitea', primaryType: 'cafe' },
    { name: 'Antipodean Coffee Roasters', primaryType: 'cafe' },
    { name: 'J.CO Donuts', primaryType: 'donut_shop' },
  ];
  it('keeps only the milk-tea entries', () => {
    const kept = filterRelevantCompetitors(list, milk);
    expect(kept.map((k) => k.name)).toEqual(['Macao Imperial Tea', 'Serenitea']);
  });
  it('computes a ratio', () => {
    expect(relevanceRatio(list, milk)).toBe(0.5);
    expect(relevanceRatio([], milk)).toBe(1); // empty → no pollution
  });
});
