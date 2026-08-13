/**
 * Vertical → Google Places type/keyword mapping. Pure data (no imports) so the
 * demo pulls establishments that actually match the business the user picked at
 * intake. Uses Places API (New) `includedTypes` where a clean type exists, plus a
 * `keyword` for text search when the category is finer than Google's type list.
 *
 * https://developers.google.com/maps/documentation/places/web-service/place-types
 */
export interface PlaceQuery {
  /** Google Place types for Nearby Search. */
  includedTypes: string[];
  /** Text-search keyword for finer categories (e.g. "milk tea"). */
  keyword: string;
  /** Human label for the competitor set. */
  label: string;
}

const MAP: Record<string, PlaceQuery> = {
  fnb_qsr: { includedTypes: ['fast_food_restaurant', 'restaurant'], keyword: 'fast food', label: 'QSR / fast food' },
  fnb_cafe: { includedTypes: ['cafe', 'coffee_shop'], keyword: 'milk tea coffee', label: 'cafés & milk tea' },
  fnb_bakery: { includedTypes: ['bakery'], keyword: 'bakery', label: 'bakeries' },
  retail_apparel: { includedTypes: ['clothing_store'], keyword: 'apparel', label: 'apparel stores' },
  retail_specialty: { includedTypes: ['store'], keyword: 'specialty retail', label: 'specialty retail' },
  convenience: { includedTypes: ['convenience_store'], keyword: 'convenience store', label: 'convenience stores' },
  remittance: { includedTypes: ['bank', 'finance'], keyword: 'remittance padala', label: 'remittance / financial' },
  pharmacy: { includedTypes: ['pharmacy', 'drugstore'], keyword: 'pharmacy drugstore', label: 'pharmacies' },
  diagnostics: { includedTypes: ['doctor', 'medical_lab'], keyword: 'diagnostic laboratory', label: 'diagnostic centers' },
  services_salon: { includedTypes: ['hair_salon', 'beauty_salon'], keyword: 'salon barber', label: 'salons / barbers' },
  services_spa: { includedTypes: ['spa'], keyword: 'spa wellness', label: 'spas' },
  services_fitness: { includedTypes: ['gym', 'fitness_center'], keyword: 'gym fitness', label: 'gyms' },
  services_laundry: { includedTypes: ['laundry'], keyword: 'laundromat labada', label: 'laundry shops' },
  fuel: { includedTypes: ['gas_station'], keyword: 'gas station', label: 'gas stations' },
  automotive: { includedTypes: ['car_repair'], keyword: 'auto service', label: 'automotive services' },
  hotel: { includedTypes: ['hotel', 'lodging'], keyword: 'hotel', label: 'hotels' },
  education: { includedTypes: ['school'], keyword: 'review center tutorial', label: 'schools / review centers' },
  other: { includedTypes: ['store'], keyword: '', label: 'establishments' },
};

export function placeQueryForVertical(vertical: string): PlaceQuery {
  return MAP[vertical] ?? MAP.other;
}

/** POI category we store real competitors under (they inform competition scoring). */
export const REAL_POI_CATEGORY = 'competitor' as const;
