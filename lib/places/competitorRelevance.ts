/**
 * Competitor relevance — decides whether a place Google returned is a GENUINE
 * competitor of the user's concept, so a Territorial / competition read isn't
 * polluted by same-category-but-different-concept establishments.
 *
 * The problem this solves (F&B especially): asking Google for a milk-tea concept's
 * competitors via includedTypes `["cafe","coffee_shop"]` also returns specialty
 * coffee roasters, donut shops and general restaurants — which are NOT milk-tea
 * competitors. Two food places sharing a Google type do not necessarily compete.
 *
 * Approach: a concept taxonomy per (vertical, sub-concept) that pairs Google types
 * with NAME/keyword signals (allow + deny). A place counts as a competitor only when
 * it matches the concept's type set AND its name signals the same concept (or the
 * concept has no name discriminator, e.g. pharmacies, where the type alone is enough).
 *
 * Pure data + pure functions (no imports) so it is fully unit-testable.
 */

export interface ConceptDef {
  /** Stable key. */
  key: string;
  /** Human label for the competitor set. */
  label: string;
  /** Google Place types to fetch (broad — the name filter narrows it). */
  includedTypes: string[];
  /** Text-search phrase for the finer concept (used by text-search fallback). */
  keyword: string;
  /**
   * Name signals that CONFIRM a place is this concept. If non-empty, a place must
   * match at least one (case-insensitive substring) to count — UNLESS its primaryType
   * is in allowTypes. If both allowName and allowTypes are empty, the includedTypes
   * filter alone is sufficient (unambiguous categories, e.g. pharmacy).
   */
  allowName: string[];
  /** Primary types that CONFIRM the concept regardless of name (e.g. tea_house). */
  allowTypes?: string[];
  /** Name signals that DISQUALIFY a place even if its type matched. */
  denyName: string[];
  /** Primary types that DISQUALIFY (e.g. a milk-tea concept excludes fine_dining). */
  denyTypes: string[];
}

/**
 * Concept catalog. Keyed by a concept slug. A vertical maps to one or more concepts;
 * the sub-concept is chosen from the brand/concept text at intake (see conceptFor()).
 */
export const CONCEPTS: Record<string, ConceptDef> = {
  // --- F&B: the tricky ones -------------------------------------------------
  milk_tea: {
    key: 'milk_tea',
    label: 'milk tea & bubble tea',
    // tea_house / tea_store are how Google types most milk-tea shops; cafe/coffee_shop
    // catch the ones typed generically. A text search on the keyword finds them best.
    includedTypes: ['tea_house', 'tea_store', 'cafe', 'coffee_shop'],
    keyword: 'milk tea bubble tea',
    allowName: ['milk tea', 'milktea', 'bubble tea', 'boba', 'tea', 'cha', 'gong', 'chatime', 'macao', 'coco', 'serenitea', 'sharetea', 'dakasi', 'happy lemon', 'infinitea', 'tiger sugar', 'yifang', 'kokobop', 'partea', 'brotea', 'koi', 'chagee', 'chicha', 'bober', 'joybean', 'teami', 'sip'],
    allowTypes: ['tea_house', 'tea_store'],
    denyName: ['roaster', 'roastery', 'specialty coffee', 'espresso', 'donut', 'doughnut', 'bakeshop'],
    denyTypes: ['donut_shop', 'bakery', 'vegan_restaurant', 'fine_dining_restaurant'],
  },
  coffee: {
    key: 'coffee',
    label: 'coffee shops',
    includedTypes: ['cafe', 'coffee_shop'],
    keyword: 'coffee espresso',
    allowName: ['coffee', 'cafe', 'café', 'espresso', 'roaster', 'roastery', 'brew', 'starbucks', 'bo\'s', 'coffee bean', 'tim hortons', 'seattle', 'figaro', 'grounds'],
    denyName: ['milk tea', 'bubble tea', 'boba'],
    denyTypes: ['fine_dining_restaurant'],
  },
  qsr: {
    key: 'qsr',
    label: 'QSR / fast food',
    includedTypes: ['fast_food_restaurant'],
    keyword: 'fast food',
    // Type is a good discriminator for QSR; a small deny list keeps out fine dining.
    allowName: [],
    denyName: ['fine dining', 'buffet', 'omakase', 'degustation'],
    denyTypes: ['fine_dining_restaurant', 'vegan_restaurant'],
  },
  chinese_qsr: {
    key: 'chinese_qsr',
    label: 'Chinese-Filipino QSR',
    includedTypes: ['chinese_restaurant', 'fast_food_restaurant'],
    keyword: 'chinese fast food',
    // A Chinese-Filipino QSR (Chowking) competes with other Chinese fast food —
    // not burger QSR or fine dining. chinese_restaurant type confirms; name signals help.
    allowName: ['chinese', 'chowking', 'panda express', 'ling nam', 'wai ying', 'chuan kee', 'dimsum', 'dim sum', 'noodle', 'wok', 'canton', 'mami', 'siomai', 'hen lin', 'north park'],
    allowTypes: ['chinese_restaurant'],
    denyName: ['fine dining', 'omakase'],
    denyTypes: ['fine_dining_restaurant', 'vegan_restaurant'],
  },
  casual_dining: {
    key: 'casual_dining',
    label: 'casual / full-service dining',
    includedTypes: ['restaurant', 'family_restaurant'],
    keyword: 'family restaurant casual dining',
    // Sit-down full-service — competes with other family/casual restaurants, NOT with
    // QSR/fast food or kiosks. Broad by nature; deny the fast-food + beverage-only types.
    allowName: [],
    allowTypes: ['family_restaurant', 'italian_restaurant', 'steak_house', 'buffet_restaurant', 'seafood_restaurant', 'restaurant'],
    denyName: ['milk tea', 'coffee', 'kiosk'],
    denyTypes: ['fast_food_restaurant', 'cafe', 'coffee_shop', 'tea_house', 'tea_store', 'bakery', 'donut_shop'],
  },
  grilled_qsr: {
    key: 'grilled_qsr',
    label: 'grilled-chicken QSR',
    includedTypes: ['chicken_restaurant', 'barbecue_restaurant', 'fast_food_restaurant'],
    keyword: 'grilled chicken restaurant',
    // Mang Inasal competes with other grilled/BBQ chicken concepts — not burger QSR,
    // not steakhouse/Mexican grill. chicken/BBQ types + name signals confirm.
    allowName: ['inasal', 'grill', 'chicken', 'bacolod', 'peri', 'bbq', 'barbecue', 'pollo', 'lechon', 'chooks', 'andok', 'baliwag'],
    allowTypes: ['chicken_restaurant', 'barbecue_restaurant'],
    denyName: ['burger', 'pizza', 'steak', 'roadhouse', 'mexican', 'korean'],
    denyTypes: ['steak_house', 'mexican_restaurant', 'korean_restaurant', 'american_restaurant', 'pizza_restaurant'],
  },
  water: {
    key: 'water',
    label: 'water refilling stations',
    includedTypes: ['store'],
    keyword: 'water refilling station',
    // Google types these inconsistently (supplier / point_of_interest / blank), so the
    // NAME is the discriminator — a water station competes only with other water stations.
    allowName: ['water refilling', 'water station', 'refilling station', 'aquabest', 'crystal clear', 'aqua', 'alkaline water', 'purified water'],
    denyName: [],
    denyTypes: [],
  },
  bakery: {
    key: 'bakery',
    label: 'bakeries & bakeshops',
    includedTypes: ['bakery'],
    keyword: 'bakery bakeshop',
    allowName: [],
    denyName: [],
    denyTypes: [],
  },
  // --- Non-F&B: type is usually enough (no name discriminator needed) --------
  pharmacy: { key: 'pharmacy', label: 'pharmacies', includedTypes: ['pharmacy', 'drugstore'], keyword: 'pharmacy drugstore', allowName: [], denyName: [], denyTypes: [] },
  convenience: { key: 'convenience', label: 'convenience stores', includedTypes: ['convenience_store'], keyword: 'convenience store', allowName: [], denyName: [], denyTypes: ['supermarket'] },
  fuel: { key: 'fuel', label: 'fuel stations', includedTypes: ['gas_station'], keyword: 'gas station', allowName: [], denyName: [], denyTypes: [] },
  apparel: { key: 'apparel', label: 'apparel stores', includedTypes: ['clothing_store'], keyword: 'apparel clothing', allowName: [], denyName: [], denyTypes: [] },
  fitness: { key: 'fitness', label: 'gyms & fitness', includedTypes: ['gym', 'fitness_center'], keyword: 'gym fitness', allowName: [], denyName: [], denyTypes: [] },
  salon: { key: 'salon', label: 'salons & barbers', includedTypes: ['hair_salon', 'beauty_salon'], keyword: 'salon barber', allowName: [], denyName: [], denyTypes: [] },
  spa: { key: 'spa', label: 'spas & wellness', includedTypes: ['spa'], keyword: 'spa wellness', allowName: [], denyName: [], denyTypes: [] },
  laundry: { key: 'laundry', label: 'laundromats', includedTypes: ['laundry'], keyword: 'laundromat', allowName: [], denyName: [], denyTypes: [] },
  remittance: { key: 'remittance', label: 'remittance & pawnshops', includedTypes: ['bank', 'finance'], keyword: 'remittance padala pawnshop', allowName: ['remittance', 'padala', 'pawnshop', 'lhuillier', 'cebuana', 'western union', 'palawan', 'money'], denyName: [], denyTypes: [] },
  diagnostics: { key: 'diagnostics', label: 'diagnostic centers', includedTypes: ['medical_lab', 'medical_clinic', 'doctor'], keyword: 'diagnostic laboratory clinic', allowName: [], allowTypes: ['medical_lab', 'medical_clinic', 'medical_center'], denyName: [], denyTypes: [] },
  hotel: { key: 'hotel', label: 'hotels', includedTypes: ['hotel', 'lodging'], keyword: 'hotel', allowName: [], denyName: [], denyTypes: [] },
  automotive: {
    key: 'automotive', label: 'auto service centers',
    includedTypes: ['car_repair'], keyword: 'auto repair service center',
    // car_repair is a clean type. Exclude pure car-wash / parts-only where the name says so.
    allowName: [], allowTypes: ['car_repair'],
    denyName: ['car wash', 'carwash'], denyTypes: ['car_wash'],
  },
  nail_salon: {
    key: 'nail_salon', label: 'nail salons & spas',
    includedTypes: ['nail_salon', 'beauty_salon'], keyword: 'nail salon',
    // A nail spa competes with other nail salons — not general hair salons or massage-only spas.
    allowName: ['nail', 'nails', 'manicure', 'pedicure', 'polish', 'nailaholics'],
    allowTypes: ['nail_salon'],
    denyName: ['barber', 'massage', 'hair'], denyTypes: ['hair_salon', 'barber_shop'],
  },
  bookstore: {
    key: 'bookstore', label: 'bookstores & school supplies',
    includedTypes: ['book_store', 'store'], keyword: 'bookstore school supplies',
    // book_store type confirms; name signal catches ones typed as generic 'store'.
    allowName: ['book', 'bookshop', 'bookstore', 'school supplies', 'office supplies', 'national', 'pandayan', 'booksale', 'fully booked', 'powerbooks'],
    allowTypes: ['book_store'],
    denyName: [], denyTypes: ['clothing_store'],
  },
  education: { key: 'education', label: 'schools / review centers', includedTypes: ['school'], keyword: 'review center tutorial', allowName: [], denyName: [], denyTypes: [] },
  generic: { key: 'generic', label: 'establishments', includedTypes: ['store'], keyword: '', allowName: [], denyName: [], denyTypes: [] },
};

/**
 * Choose the concept for a run from its vertical + optional brand/concept text.
 * F&B verticals disambiguate by name signal (milk-tea vs coffee vs QSR); everything
 * else maps straight to its concept.
 */
export function conceptFor(vertical: string, brandOrConcept?: string): ConceptDef {
  const hay = (brandOrConcept ?? '').toLowerCase();
  if (vertical === 'fnb_cafe') {
    // Milk-tea signal wins; else coffee.
    if (/milk tea|milktea|bubble|boba|\btea\b|cha\b|chatime|macao|serenitea|gong ?cha|coco|sharetea|dakasi|infinitea/.test(hay)) return CONCEPTS.milk_tea;
    return CONCEPTS.coffee;
  }
  if (vertical === 'fnb_qsr') {
    // Sub-concept by name signal: grilled-chicken, Chinese-Filipino QSR, casual dining, else QSR.
    if (/inasal|grill|bacolod|peri.?peri|bbq|barbecue|chooks|andok|baliwag|lechon manok/.test(hay)) return CONCEPTS.grilled_qsr;
    if (/chinese|chowking|panda|ling nam|wai ying|dimsum|dim sum|canton|siomai|mami|hen lin/.test(hay)) return CONCEPTS.chinese_qsr;
    if (/casual|full.?service|family restaurant|max'?s|vikings|buffet|dine.?in|bistro|steak|italian/.test(hay)) return CONCEPTS.casual_dining;
    return CONCEPTS.qsr;
  }
  if (vertical === 'fnb_bakery') return CONCEPTS.bakery;
  // Water refilling comes in as 'other' with a water name signal.
  if (/water refilling|water station|aquabest|refilling station|purified water|alkaline water/.test(hay)) return CONCEPTS.water;
  // Nail concept (salon or spa vertical with a nail signal).
  if ((vertical === 'services_salon' || vertical === 'services_spa') && /nail|manicure|pedicure/.test(hay)) return CONCEPTS.nail_salon;
  // Bookstore / school-supply concept (specialty retail with a book signal).
  if (vertical === 'retail_specialty' && /book|national book|pandayan|school supplies|office supplies/.test(hay)) return CONCEPTS.bookstore;
  const map: Record<string, string> = {
    pharmacy: 'pharmacy', convenience: 'convenience', fuel: 'fuel', retail_apparel: 'apparel',
    retail_specialty: 'apparel', services_fitness: 'fitness', services_salon: 'salon',
    services_spa: 'spa', services_laundry: 'laundry', remittance: 'remittance',
    diagnostics: 'diagnostics', hotel: 'hotel', automotive: 'automotive', education: 'education',
  };
  return CONCEPTS[map[vertical]] ?? CONCEPTS.generic;
}

export interface PlaceLike { name: string; primaryType?: string | null; }

/**
 * Is this place a genuine competitor of the concept?
 * - primaryType in denyTypes → NO.
 * - name matches a denyName → NO.
 * - concept has allowName signals → require at least one to match.
 * - concept has no allowName signals → the type filter already qualified it → YES.
 */
export function isRelevantCompetitor(place: PlaceLike, concept: ConceptDef): boolean {
  const name = (place.name ?? '').toLowerCase();
  const type = (place.primaryType ?? '').toLowerCase();

  if (concept.denyTypes.some((t) => type === t.toLowerCase())) return false;
  if (concept.denyName.some((d) => name.includes(d.toLowerCase()))) return false;
  // A primaryType in allowTypes confirms the concept regardless of name.
  if (concept.allowTypes?.some((t) => type === t.toLowerCase())) return true;
  if (concept.allowName.length > 0) {
    return concept.allowName.some((a) => name.includes(a.toLowerCase()));
  }
  return true;
}

/** Filter a list of places to genuine competitors of the concept. */
export function filterRelevantCompetitors<T extends PlaceLike>(places: T[], concept: ConceptDef): T[] {
  return places.filter((p) => isRelevantCompetitor(p, concept));
}

/** Relevance ratio (0–1) — for the QA Gate B check and a UI confidence read. */
export function relevanceRatio(places: PlaceLike[], concept: ConceptDef): number {
  if (!places.length) return 1;
  const kept = places.filter((p) => isRelevantCompetitor(p, concept)).length;
  return kept / places.length;
}

/* ---------------------------------------------------------------------------
 * Name-based categorization for the Explore tool.
 *
 * DB POIs carry no Google primaryType, so we classify each establishment into a
 * single best category from its NAME alone. Order matters: the first category whose
 * signals match wins, so specific concepts (milk tea, grilled QSR) are checked before
 * broad ones (coffee, casual dining). Anything unmatched falls to "other".
 * ------------------------------------------------------------------------- */
export interface ExploreCategory { key: string; label: string; }

const NAME_CATEGORY_RULES: Array<{ key: string; label: string; any: string[] }> = [
  { key: 'milk_tea', label: 'Milk tea & bubble tea', any: ['milk tea', 'milktea', 'bubble tea', 'chatime', 'gong cha', 'cha ', 'coco ', 'macao imperial', 'serenitea', 'happy lemon', 'tiger sugar', 'infinitea', 'dakasi', 'teaspresso', 'partea', 'zetea', 'nashville', 'moonleaf', 'sharetea', 'yifang', 'tea corner', 'fruitea'] },
  // grilled_qsr is checked BEFORE coffee so "Kenny Rogers Roasters" isn't captured by the
  // coffee-rule token "roaster". Note we intentionally do NOT list a bare "roasters" here.
  { key: 'grilled_qsr', label: 'Grilled-chicken QSR', any: ['inasal', 'mang inasal', 'bacolod', 'lechon manok', 'andok', 'baliwag', 'kenny rogers', 'peri-peri', 'peri peri', 'barbecue', 'ihaw', 'chooks', 'grilled chicken', 'chicken grill'] },
  { key: 'coffee', label: 'Coffee shops', any: ['coffee', 'café', 'cafe', 'espresso', 'roaster', 'roastery', 'brew', 'starbucks', 'coffee bean', 'tim hortons', 'seattle', 'figaro', 'grounds', 'arabica', 'kaffe', 'latte', 'americano', 'kopi', 'bo\'s coffee', 'the barn'] },
  { key: 'chinese_qsr', label: 'Chinese-Filipino QSR', any: ['chowking', 'panda express', 'north park', 'mann hann', 'wai ying', 'dimsum', 'dim sum', 'hen lin', 'chowfun', 'wok'] },
  { key: 'qsr', label: 'QSR / fast food', any: ['jollibee', 'mcdonald', 'mcdo', 'kfc', 'burger', 'wendy', 'shakey', 'pizza', 'pizzeria', "army navy", 'french fri', 'greenwich', 'fastfood', 'fast food', 'bonchon', 'popeyes', 'yellow cab', 'angel\'s pizza', 'potato corner', 'jab bawal', 'minute burger', 'angels burger'] },
  { key: 'bakery', label: 'Bakeries & dessert', any: ['bakery', 'bakeshop', 'bake shop', 'bread', 'red ribbon', 'goldilocks', 'pastr', 'cake', 'donut', 'doughnut', 'creamery', 'ice cream', 'gelato', 'dessert', 'panaderia', 'julie\'s', 'sweet', 'krispy'] },
  { key: 'casual_dining', label: 'Casual / full-service dining', any: ['restaurant', 'ramen', 'samgyup', 'grill house', 'bistro', 'kitchen', 'dining', 'eatery', 'diner', 'buffet', 'vikings', 'italianni', 'din tai fung', 'manam', 'seafood', 'steak', 'sushi', 'lugaw', 'silog', 'bulalo', 'brasserie', 'carinderia', 'lutong', 'food house', 'noodle', 'pares', 'tapsi', 'max\'s'] },
  { key: 'pharmacy', label: 'Pharmacies', any: ['pharmacy', 'drug', 'mercury', 'watsons', 'south star', 'southstar', 'rose pharmacy', 'generika', 'the generics', 'botica', 'st. joseph drug'] },
  { key: 'convenience', label: 'Convenience stores', any: ['7-eleven', '7 eleven', 'ministop', 'family mart', 'familymart', 'alfamart', 'lawson', 'uncle john', 'convenience', 'sari-sari', 'sari sari', 'mini stop'] },
  { key: 'grocery', label: 'Grocery & supermarkets', any: ['puregold', 'winmart', 'sm supermarket', 'sm hypermarket', 'robinsons supermarket', 'supermarket', 'hypermarket', 'grocery', 'palengke', 'wet market', 'public market', 'wals', 'savemore', 'metro market', 'landers', 'shopwise', 'rustan\'s super', 'waltermart'] },
  { key: 'fuel', label: 'Fuel stations', any: ['petron', 'shell', 'caltex', 'seaoil', 'phoenix', 'total ', 'unioil', 'gas station', 'fuel station', 'gasoline', 'petrol', 'pricelocq', 'flying v', 'jetti', 'cleanfuel', 'city oil', 'petro', 'clean fuel'] },
  { key: 'bank', label: 'Banks & ATMs', any: ['bank', 'bpi', 'bdo', 'metrobank', 'landbank', 'security bank', 'unionbank', 'union bank', 'pnb', 'rcbc', 'chinabank', 'china bank', 'eastwest', 'east west', 'hsbc', 'citibank', 'maybank', 'psbank', 'philtrust', 'unionbank', 'atm', 'savings bank', 'rural bank'] },
  { key: 'remittance', label: 'Remittance & pawnshops', any: ['remittance', 'padala', 'pawnshop', 'lhuillier', 'cebuana', 'western union', 'palawan', 'moneygram', 'money changer', 'ml kwarta', 'tambunting', 'villarica'] },
  { key: 'fitness', label: 'Gyms & fitness', any: ['gym', 'fitness', 'anytime', 'gold\'s', 'crossfit', 'pilates', 'yoga', 'workout', 'muscle', 'fit '] },
  { key: 'salon', label: 'Salons & barbers', any: ['salon', 'barber', 'nails', 'nail spa', 'david\'s salon', 'lay bare', 'hair', 'brows', 'parlor', 'beauty', 'lasho', 'cut '] },
  { key: 'spa', label: 'Spas & wellness', any: ['spa', 'wellness', 'massage', 'reflexology', 'therapeutic'] },
  { key: 'laundry', label: 'Laundromats', any: ['laundry', 'laundromat', 'lavandera', 'labada', 'wash express', 'wash it', 'quickwash', 'laba'] },
  { key: 'apparel', label: 'Apparel & retail', any: ['apparel', 'clothing', 'bench', 'uniqlo', 'penshoppe', 'boutique', 'fashion', 'shoes', 'ukay', 'garments', 'tailoring'] },
  { key: 'hotel', label: 'Hotels & lodging', any: ['hotel', 'inn', 'lodge', 'suites', 'residences', 'pension', 'hostel', 'apartelle', 'transient', 'shangri-la', 'shangri la', 'raffles', 'fairmont', 'dusit', 'peninsula', 'marriott', 'sofitel', 'conrad', 'okada', 'discovery', 'seda', 'red planet', 'go hotel'] },
  { key: 'water', label: 'Water refilling', any: ['water refilling', 'water station', 'refilling station', 'aqua', 'purified water', 'aqua best', 'crystal clear', 'h2o'] },
];

/** Classify one establishment name into a single Explore category (defaults to "other"). */
export function categorizeByName(name: string): ExploreCategory {
  const n = (name ?? '').toLowerCase();
  for (const r of NAME_CATEGORY_RULES) {
    if (r.any.some((s) => n.includes(s))) return { key: r.key, label: r.label };
  }
  return { key: 'other', label: 'Other / uncategorized' };
}

/** The full ordered list of categories (for building filter dropdowns). */
export function exploreCategories(): ExploreCategory[] {
  return [...NAME_CATEGORY_RULES.map((r) => ({ key: r.key, label: r.label })), { key: 'other', label: 'Other / uncategorized' }];
}

/* ---------------------------------------------------------------------------
 * COMPETITOR TIERS — vertical-aligned relevance for map + saturation.
 *
 * Why this exists: isRelevantCompetitor() discriminates using Google's `primaryType`.
 * Establishments read from our own poi table (OSM ingests) carry primaryType = null, so
 * for every concept whose discriminator is the TYPE set rather than name signals
 * (qsr, pharmacy, convenience, fitness, fuel, salon, laundry, hotel…) that function fell
 * through to `return true` — i.e. EVERY nearby business counted as a competitor. That is
 * how a fuel station ("Metro Oil") and a gym ("Central Seminary Gym") ended up plotted as
 * competitors of a Jollibee site, and counted in its saturation.
 *
 * The fix: tier by the establishment NAME, which DB POIs do have, reusing the same
 * categorizeByName() classifier the Explore tool uses. Three tiers:
 *
 *   direct    — same concept. A real rival for the same trade (Jollibee ↔ McDonald's,
 *               KFC, Chowking). Counts fully toward competitive saturation.
 *   adjacent  — sells into the same demand but it is NOT their primary business
 *               (Alfamart, bakeries, carinderias vs a QSR). Takes a slice of the same
 *               spend, so it counts at a REDUCED weight — never as a full rival.
 *   unrelated — a different vertical entirely (gym, fuel, bank). Never a competitor;
 *               plotted only as faint context so the user can still read how built-up
 *               the corridor is.
 *
 * Pure functions over pure data — unit-testable, no imports.
 * ------------------------------------------------------------------------- */

export type RelevanceTier = 'direct' | 'adjacent' | 'unrelated';

/**
 * How much an ADJACENT establishment counts toward competitive saturation relative to a
 * direct rival. A convenience store does compete for a QSR's snack spend — but it is not
 * a second Jollibee, and pretending otherwise would overstate saturation.
 */
export const ADJACENT_WEIGHT = 0.35;

/**
 * Per-concept tier matrix, expressed in categorizeByName() keys. Anything not listed in
 * `direct` or `adjacent` is unrelated.
 *
 * Concepts deliberately ABSENT here (diagnostics, automotive, bookstore, education,
 * generic) have no dependable name-category counterpart yet, so they fall back to the
 * legacy type/name filter rather than being wrongly zeroed out — see tierFor().
 */
const CONCEPT_TIERS: Record<string, { direct: string[]; adjacent: string[] }> = {
  // --- F&B ---------------------------------------------------------------
  // A QSR competes with other quick-service food; sit-down places, bakeries and
  // convenience/grocery take a share of the same meal & snack spend, but are not rivals.
  qsr: {
    direct: ['qsr', 'chinese_qsr', 'grilled_qsr'],
    adjacent: ['casual_dining', 'bakery', 'convenience', 'grocery', 'coffee', 'milk_tea'],
  },
  chinese_qsr: {
    direct: ['chinese_qsr', 'qsr', 'grilled_qsr'],
    adjacent: ['casual_dining', 'bakery', 'convenience', 'grocery'],
  },
  grilled_qsr: {
    direct: ['grilled_qsr', 'qsr', 'chinese_qsr'],
    adjacent: ['casual_dining', 'bakery', 'convenience', 'grocery'],
  },
  casual_dining: {
    direct: ['casual_dining'],
    adjacent: ['qsr', 'chinese_qsr', 'grilled_qsr', 'bakery', 'coffee'],
  },
  milk_tea: { direct: ['milk_tea'], adjacent: ['coffee', 'bakery', 'convenience', 'qsr'] },
  coffee: { direct: ['coffee'], adjacent: ['milk_tea', 'bakery', 'convenience', 'casual_dining'] },
  bakery: { direct: ['bakery'], adjacent: ['coffee', 'milk_tea', 'convenience', 'grocery', 'casual_dining'] },
  // --- Retail / services -------------------------------------------------
  convenience: { direct: ['convenience'], adjacent: ['grocery', 'bakery', 'qsr', 'pharmacy', 'fuel'] },
  pharmacy: { direct: ['pharmacy'], adjacent: ['convenience', 'grocery'] },
  fuel: { direct: ['fuel'], adjacent: ['convenience'] },
  apparel: { direct: ['apparel'], adjacent: [] },
  fitness: { direct: ['fitness'], adjacent: ['spa'] },
  salon: { direct: ['salon'], adjacent: ['spa'] },
  nail_salon: { direct: ['salon'], adjacent: ['spa'] },
  spa: { direct: ['spa'], adjacent: ['salon', 'fitness'] },
  laundry: { direct: ['laundry'], adjacent: [] },
  remittance: { direct: ['remittance'], adjacent: ['bank'] },
  hotel: { direct: ['hotel'], adjacent: [] },
  water: { direct: ['water'], adjacent: ['convenience', 'grocery'] },
};

/** Human labels for each tier — used in map popups, legends and the report. */
export const TIER_LABEL: Record<RelevanceTier, string> = {
  direct: 'Direct competitor',
  adjacent: 'Adjacent — sells similar, different format',
  unrelated: 'Nearby business — not a competitor',
};

/**
 * Tier one establishment against the run's concept.
 *
 * A Google `primaryType`, when present, is the strongest signal and is honoured first —
 * an unbranded "Kusina ni Nanay" typed `fast_food_restaurant` is a direct QSR rival even
 * though its name gives nothing away. Otherwise (and for every DB/OSM place) the NAME
 * category decides. A concept-level denyName demotes rather than deletes: a coffee
 * roastery near a milk-tea concept is adjacent, not a direct rival.
 */
export function tierFor(place: PlaceLike, concept: ConceptDef): RelevanceTier {
  const tiers = CONCEPT_TIERS[concept.key];
  const name = (place.name ?? '').toLowerCase();
  const type = (place.primaryType ?? '').toLowerCase();

  // Unmapped concept → keep the legacy behaviour rather than silently returning nothing.
  if (!tiers) return isRelevantCompetitor(place, concept) ? 'direct' : 'unrelated';

  const denied = concept.denyName.some((d) => name.includes(d.toLowerCase()));
  const cat = categorizeByName(place.name).key;

  // 1) Type-based decision (Google path only — DB places have no primaryType).
  if (type) {
    if (concept.denyTypes.some((t) => t.toLowerCase() === type)) {
      return tiers.adjacent.includes(cat) ? 'adjacent' : 'unrelated';
    }
    const typeMatches =
      concept.includedTypes.some((t) => t.toLowerCase() === type) ||
      (concept.allowTypes?.some((t) => t.toLowerCase() === type) ?? false);
    if (typeMatches) return denied ? 'adjacent' : 'direct';
  }

  // 2) Name-category decision — the path every DB/OSM establishment takes.
  if (tiers.direct.includes(cat)) return denied ? 'adjacent' : 'direct';
  if (tiers.adjacent.includes(cat)) return 'adjacent';
  return 'unrelated';
}

export interface TierCounts { direct: number; adjacent: number; unrelated: number }

/** Count a set of places by tier. */
export function tierCounts(places: PlaceLike[], concept: ConceptDef): TierCounts {
  const out: TierCounts = { direct: 0, adjacent: 0, unrelated: 0 };
  for (const p of places) out[tierFor(p, concept)]++;
  return out;
}

/**
 * Saturation-weighted competitor count: direct rivals count in full, adjacent formats at
 * ADJACENT_WEIGHT, unrelated businesses not at all. Rounded to 1dp — this feeds the
 * saturation model, which is Projected either way.
 */
export function weightedCompetitorCount(counts: TierCounts): number {
  return Math.round((counts.direct + counts.adjacent * ADJACENT_WEIGHT) * 10) / 10;
}

/** Sort order for the map so food/direct rivals draw and read FIRST. */
export const TIER_ORDER: Record<RelevanceTier, number> = { direct: 0, adjacent: 1, unrelated: 2 };
