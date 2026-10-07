/**
 * Capture layers — what an admin can pull for an area. Pure + client-safe (the screen lists them;
 * the API resolves their Overpass selectors server-side). Selectors are constants from this file or
 * from osmService's vertical table — NEVER user text — so nothing a client sends reaches Overpass QL.
 *
 * The "Everyday anchors" layer is grid-navigator's major-POI whitelist (the places you navigate by),
 * blended into BSA. Categories come from lib/places/osmCategory `captureCategory`, so anything shared
 * with the CLI sweep (pharmacies, banks, fuel…) lands in the same category the modules already read.
 */

export type BaseLayerKey = 'anchors' | 'transport' | 'health' | 'education' | 'malls' | 'offices';
export type LayerKey = BaseLayerKey | `v:${string}`;

export interface LayerDef {
  key: LayerKey;
  label: string;
  hint: string;
}

/** Tag selectors per base layer (Overpass filter syntax, the part inside []). */
export const BASE_LAYER_SELECTORS: Record<BaseLayerKey, string[]> = {
  // grid-navigator's navigation whitelist (minus the bits BSA files elsewhere).
  anchors: [
    '"amenity"="pharmacy"', '"shop"="supermarket"', '"amenity"="marketplace"', '"amenity"="fuel"',
    '"amenity"="bank"', '"amenity"="atm"', '"amenity"="bureau_de_change"', '"amenity"="place_of_worship"',
    '"amenity"="police"', '"amenity"="fire_station"', '"amenity"="post_office"', '"amenity"="community_centre"',
    '"shop"="water"',
  ],
  transport: [
    '"highway"="bus_stop"', '"amenity"="bus_station"', '"public_transport"="station"',
    '"railway"="station"', '"railway"="halt"', '"railway"="tram_stop"', '"amenity"="ferry_terminal"',
  ],
  health: [
    '"amenity"="hospital"', '"amenity"="clinic"', '"amenity"="doctors"', '"amenity"="dentist"',
    '"healthcare"="laboratory"', '"healthcare"="clinic"', '"healthcare"="centre"',
  ],
  education: [
    '"amenity"="school"', '"amenity"="college"', '"amenity"="university"', '"amenity"="kindergarten"',
    '"office"="educational_institution"', '"amenity"="prep_school"',
  ],
  malls: ['"shop"="mall"', '"shop"="department_store"'],
  offices: ['"amenity"="townhall"', '"office"="government"', '"office"="company"', '"amenity"="courthouse"'],
};

export const BASE_LAYERS: LayerDef[] = [
  { key: 'anchors', label: 'Everyday anchors', hint: 'Pharmacies, supermarkets, markets, fuel, banks/ATMs, churches, police, water stations (grid-navigator set)' },
  { key: 'transport', label: 'Transport', hint: 'Jeepney/bus stops, terminals, rail and ferry stations' },
  { key: 'health', label: 'Health', hint: 'Hospitals, clinics, doctors, dentists, laboratories' },
  { key: 'education', label: 'Education', hint: 'Schools, colleges, universities' },
  { key: 'malls', label: 'Malls', hint: 'Malls and department stores' },
  { key: 'offices', label: 'Offices & civic', hint: 'Town/city halls, government and company offices' },
];

/** Franchise verticals (competitor sets) — keys must exist in osmService.OSM_SELECTORS. */
export const VERTICAL_LAYERS: LayerDef[] = [
  { key: 'v:fnb_qsr', label: 'Quick-service & restaurants', hint: 'Fast food and restaurants' },
  { key: 'v:fnb_cafe', label: 'Cafés & milk tea', hint: 'Cafés, coffee, bubble tea' },
  { key: 'v:fnb_bakery', label: 'Bakeries', hint: 'Bakeries and pastry shops' },
  { key: 'v:convenience', label: 'Convenience stores', hint: 'Convenience stores' },
  { key: 'v:grocery', label: 'Grocery', hint: 'Supermarkets, groceries, wholesale, markets' },
  { key: 'v:pharmacy', label: 'Pharmacies', hint: 'Pharmacies and chemists' },
  { key: 'v:retail_apparel', label: 'Apparel retail', hint: 'Clothes, shoes, boutiques' },
  { key: 'v:retail_specialty', label: 'Specialty retail', hint: 'Variety, water, books, gifts, toys, cosmetics' },
  { key: 'v:hardware', label: 'Hardware', hint: 'Hardware, DIY, paint, electrical' },
  { key: 'v:electronics', label: 'Electronics', hint: 'Electronics, mobile phones, computers, appliances' },
  { key: 'v:remittance', label: 'Remittance & finance', hint: 'Banks, money transfer, pawnshops, lenders' },
  { key: 'v:diagnostics', label: 'Diagnostics', hint: 'Laboratories and clinics' },
  { key: 'v:services_salon', label: 'Salons', hint: 'Hairdressers and beauty' },
  { key: 'v:services_spa', label: 'Spa & massage', hint: 'Spas and massage' },
  { key: 'v:services_fitness', label: 'Fitness', hint: 'Gyms and sports centres' },
  { key: 'v:services_laundry', label: 'Laundry', hint: 'Laundry and dry cleaning' },
  { key: 'v:fuel', label: 'Fuel', hint: 'Fuel stations' },
  { key: 'v:automotive', label: 'Automotive', hint: 'Car repair, car wash, parts, tyres' },
  { key: 'v:hotel', label: 'Hotels', hint: 'Hotels, motels, guest houses, hostels' },
  { key: 'v:education', label: 'Education (franchise)', hint: 'Schools and learning centres' },
];

export const ALL_LAYERS: LayerDef[] = [...BASE_LAYERS, ...VERTICAL_LAYERS];
export const LAYER_KEYS = ALL_LAYERS.map((l) => l.key);

export function isLayerKey(v: unknown): v is LayerKey {
  return typeof v === 'string' && (LAYER_KEYS as string[]).includes(v);
}

export function isBaseLayer(k: LayerKey): k is BaseLayerKey {
  return !k.startsWith('v:');
}

/** Transport layer keeps unnamed stops (position is what matters); every other layer needs a name. */
export function keepsUnnamed(k: LayerKey): boolean {
  return k === 'transport';
}
