/**
 * Guided intake options — dropdown choices so users click instead of typing where a
 * field has known answers. Pure data, shared by the wizard. A couple of fields stay
 * free-text where genuine nuance helps (brand concept, site preferences notes).
 *
 * Labels are user-facing; the value stored is the label itself (the intake JSON is
 * human-readable and feeds the AI context as plain classified text).
 */

export interface Option {
  value: string;
  label: string;
}

/** Vertical grouped for a friendlier picker (label → value uses the Prisma enum). */
export const VERTICAL_GROUPS: Array<{ group: string; options: Option[] }> = [
  {
    group: 'Food & Beverage',
    options: [
      { value: 'fnb_qsr', label: 'QSR / Food cart / Kiosk' },
      { value: 'fnb_cafe', label: 'Coffee shop / Café' },
      { value: 'fnb_bakery', label: 'Bakery / Dessert' },
    ],
  },
  {
    group: 'Retail',
    options: [
      { value: 'retail_apparel', label: 'Apparel / Specialty retail' },
      { value: 'retail_specialty', label: 'Specialty retail (other)' },
      { value: 'convenience', label: 'Convenience / Grocery' },
      { value: 'pharmacy', label: 'Pharmacy / Health retail' },
    ],
  },
  {
    group: 'Services',
    options: [
      { value: 'services_salon', label: 'Salon / Barber / Nails' },
      { value: 'services_spa', label: 'Spa / Wellness / Aesthetics' },
      { value: 'services_fitness', label: 'Fitness' },
      { value: 'services_laundry', label: 'Laundry' },
      { value: 'remittance', label: 'Financial / Remittance' },
      { value: 'diagnostics', label: 'Health / Diagnostics' },
      { value: 'education', label: 'Education / Review center' },
    ],
  },
  {
    group: 'Land-intensive',
    options: [
      { value: 'fuel', label: 'Fuel / LPG' },
      { value: 'automotive', label: 'Automotive services' },
      { value: 'hotel', label: 'Hotel / Travel / Leisure' },
    ],
  },
  {
    group: 'Other',
    options: [{ value: 'other', label: 'Other / Uncategorized' }],
  },
];

/** Which verticals are land-acquisition (parcel) rather than tenancy formats. */
export const LAND_VERTICALS = ['fuel', 'automotive', 'hotel'];

export const OUTLET_FORMATS: Option[] = [
  { value: 'inline', label: 'Inline (street-level unit)' },
  { value: 'mall', label: 'Mall unit' },
  { value: 'kiosk', label: 'Kiosk' },
  { value: 'standalone', label: 'Standalone / Freestanding' },
];

export const TARGET_CUSTOMER: Option[] = [
  { value: 'Young professionals & students (18–34)', label: 'Young professionals & students (18–34)' },
  { value: 'Families & residential households', label: 'Families & residential households' },
  { value: 'Office workers / CBD daytime', label: 'Office workers / CBD daytime' },
  { value: 'Upper-income / premium shoppers', label: 'Upper-income / premium shoppers' },
  { value: 'Mass-market / value-seeking', label: 'Mass-market / value-seeking' },
  { value: 'Motorists / highway traffic', label: 'Motorists / highway traffic' },
];

export const INCOME_BAND: Option[] = [
  { value: 'AB (upper)', label: 'AB — upper income' },
  { value: 'B–C (middle)', label: 'B–C — middle income' },
  { value: 'C–D (mass)', label: 'C–D — mass market' },
  { value: 'Mixed', label: 'Mixed / no strong skew' },
];

export const EXPANSION_GOAL: Option[] = [
  { value: '1–3 branches (pilot)', label: '1–3 branches (pilot)' },
  { value: '4–10 branches (12 months)', label: '4–10 branches (12 months)' },
  { value: '10+ branches (aggressive)', label: '10+ branches (aggressive)' },
  { value: 'Region-wide network build', label: 'Region-wide network build' },
];

export const FOOTPRINT: Option[] = [
  { value: 'Under 40 sqm (kiosk/small)', label: 'Under 40 sqm (kiosk / small)' },
  { value: '40–80 sqm (standard inline)', label: '40–80 sqm (standard inline)' },
  { value: '80–150 sqm (large)', label: '80–150 sqm (large)' },
  { value: '150+ sqm / land parcel', label: '150+ sqm / land parcel' },
];

export const SITE_PREFERENCE: Option[] = [
  { value: 'High-footfall corridors near offices/transit', label: 'High-footfall corridors (offices / transit)' },
  { value: 'Malls & shopping centers', label: 'Malls & shopping centers' },
  { value: 'Residential neighbourhoods', label: 'Residential neighbourhoods' },
  { value: 'Near schools / campuses', label: 'Near schools / campuses' },
  { value: 'Highway / roadside frontage', label: 'Highway / roadside frontage' },
  { value: 'Near clinics / hospitals', label: 'Near clinics / hospitals' },
];

export const CONSENT: Option[] = [
  { value: 'Consent given — data may be used for analysis & audit', label: 'Yes — I consent to data use for analysis & audit' },
  { value: 'Consent withheld', label: 'No' },
];

/**
 * Category-conditional intake fields (QA v6). Some categories need an input the
 * generic dropdowns don't capture: land verticals need a parcel/frontage read;
 * mall-dependent formats need a mall-tier target; per-unit service formats
 * (salon chairs, laundry machines, water refill lines) need a unit count so the
 * modules can surface a pop-per-unit / breakeven read. Each is shown only when the
 * chosen vertical needs it, and each accepts a dropdown OR manual entry.
 */

/** Mall-tier target — for mall-dependent formats (apparel, spa, some retail). */
export const MALL_TIER: Option[] = [
  { value: 'Tier A super-regional (e.g. SM Megamall, MOA, Ayala Glorietta)', label: 'Tier A — super-regional mall' },
  { value: 'Tier B regional (e.g. SM city, Robinsons, Ayala mid)', label: 'Tier B — regional mall' },
  { value: 'Tier C community / neighbourhood mall', label: 'Tier C — community mall' },
  { value: 'High-street / non-mall retail', label: 'High-street (non-mall)' },
];

/** Land verticals — capture a parcel/lot/frontage requirement (fuel, automotive, hotel). */
export const LAND_PARCEL: Option[] = [
  { value: 'Corner lot ≥ 1,000 sqm with two-road frontage', label: 'Corner lot ≥1,000 sqm (two frontages)' },
  { value: 'Inline lot 500–1,000 sqm, ≥ 20 m frontage', label: 'Inline lot 500–1,000 sqm (≥20 m frontage)' },
  { value: 'Building / lot 1,000–3,000 sqm (hotel / large format)', label: 'Building/lot 1,000–3,000 sqm' },
  { value: 'Small lot < 500 sqm (service bay / kiosk)', label: 'Small lot <500 sqm' },
];

/** Per-unit capacity — chairs / machines / refill lines for pop-per-unit & breakeven. */
export const SERVICE_UNITS: Option[] = [
  { value: '1–4 units (chairs / machines / lines)', label: '1–4 units' },
  { value: '5–8 units', label: '5–8 units' },
  { value: '9–15 units', label: '9–15 units' },
  { value: '16+ units (large format)', label: '16+ units' },
];

/** Which verticals should show the mall-tier field. */
export const MALL_VERTICALS = ['retail_apparel', 'retail_specialty', 'services_spa'];
/** Which verticals should show the per-unit capacity field. */
export const UNIT_VERTICALS = ['services_salon', 'services_laundry'];
/** Water-refill sits under convenience/other in the picker; a name signal also triggers units. */
export const UNIT_NAME_SIGNALS = ['water', 'refill', 'laundry', 'wash', 'salon', 'barber', 'nail'];
