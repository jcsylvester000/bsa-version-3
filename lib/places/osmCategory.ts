/**
 * OSM tag → BSA `PoiCategory`. Pure and client-safe (no server imports) so the admin capture
 * screen, the loaders and the tests all share ONE mapping.
 *
 * `osmTagToPoiCategory` is the original ingest rule (moved here unchanged from osmService so
 * existing data keeps its meaning): business establishments default to `competitor`, which is
 * what `competitorsNear` reads — the concept engine then decides which competitors are relevant.
 *
 * `captureCategory` adds civic overrides for tags that are NOT businesses (a church, a town hall,
 * a fire station) so the admin capture never files them as competitors. Everything else falls
 * through to the original rule, so a pharmacy captured from the admin screen lands in exactly the
 * same category as one from the CLI sweep (otherwise a re-capture would flip the category of an
 * existing row and hide it from Territory Guard).
 */

export type BsaPoiCategory =
  | 'competitor' | 'anchor' | 'transport' | 'school' | 'hospital' | 'clinic'
  | 'diagnostic' | 'mall' | 'office' | 'residential' | 'other';

export const BSA_POI_CATEGORIES: BsaPoiCategory[] = [
  'competitor', 'anchor', 'transport', 'school', 'hospital', 'clinic',
  'diagnostic', 'mall', 'office', 'residential', 'other',
];

export function isBsaPoiCategory(v: unknown): v is BsaPoiCategory {
  return typeof v === 'string' && (BSA_POI_CATEGORIES as string[]).includes(v);
}

/** Original ingest rule (unchanged). Map an OSM tag value to the app's PoiCategory. */
export function osmTagToPoiCategory(osmTag: string | null): string {
  const t = (osmTag ?? '').toLowerCase();
  if (/(school|educational_institution|prep_school)/.test(t)) return 'school';
  if (/(hospital)/.test(t)) return 'hospital';
  if (/(clinic|doctors)/.test(t)) return 'clinic';
  if (/(laboratory)/.test(t)) return 'diagnostic';
  if (/(mall|department_store)/.test(t)) return 'mall';
  if (/(bus_station|subway|station|public_transport|halt)/.test(t)) return 'transport';
  if (/(office)/.test(t)) return 'office';
  // Everything else that's a shop/amenity business = a competitor establishment.
  return 'competitor';
}

/** Non-business civic tags → category. Checked before the ingest rule. */
const CIVIC: Record<string, BsaPoiCategory> = {
  'amenity=townhall': 'office',
  'amenity=courthouse': 'office',
  'office=government': 'office',
  'amenity=place_of_worship': 'anchor',
  'amenity=community_centre': 'anchor',
  'amenity=post_office': 'anchor',
  'amenity=police': 'other',
  'amenity=fire_station': 'other',
  'amenity=drinking_water': 'other',
  'amenity=university': 'school',
  'amenity=college': 'school',
  'amenity=kindergarten': 'school',
  'healthcare=laboratory': 'diagnostic',
  'amenity=dentist': 'clinic',
  'healthcare=centre': 'clinic',
  'healthcare=clinic': 'clinic',
  'tram_stop': 'transport',
  'highway=bus_stop': 'transport',
  'railway=tram_stop': 'transport',
  'amenity=ferry_terminal': 'transport',
};

/** Category for a captured OSM element's matched `key=value` tag. */
export function captureCategory(kind: string | null | undefined): BsaPoiCategory {
  const k = (kind ?? '').trim().toLowerCase();
  if (CIVIC[k]) return CIVIC[k];
  const c = osmTagToPoiCategory(k);
  return isBsaPoiCategory(c) ? c : 'other';
}

/** Short human label per category (admin review table). */
export const CATEGORY_LABEL: Record<BsaPoiCategory, string> = {
  competitor: 'Business (competitor set)',
  anchor: 'Anchor / footfall',
  transport: 'Transport',
  school: 'Education',
  hospital: 'Hospital',
  clinic: 'Clinic',
  diagnostic: 'Diagnostic',
  mall: 'Mall',
  office: 'Office / civic',
  residential: 'Residential',
  other: 'Other',
};

/** Generic label for an unnamed transport stop (PH OSM stop naming is sparse; position matters). */
export function transportLabel(tag: string | null): string {
  const t = tag ?? '';
  if (t.includes('railway=station') || t.includes('railway=halt')) return 'Rail station';
  if (t.includes('tram_stop')) return 'Rail/LRT stop';
  if (t.includes('bus_station')) return 'Bus/PUV terminal';
  if (t.includes('ferry')) return 'Ferry terminal';
  if (t.includes('bus_stop') || t.includes('platform') || t.includes('stop_position')) return 'Jeepney/bus stop';
  return 'Transport stop';
}
