/**
 * Canonical brand → vertical map (shared by the brands + franchisors APIs). Lets the
 * intake "Franchise brand" dropdown filter to brands that match the selected vertical.
 *
 * Not every DB brand is listed here; `verticalForBrand` returns null for unknowns, and
 * callers fall back to a sector match so newly-added brands still appear under the right
 * broad category.
 */
export interface BrandVertical {
  brand: string;
  category: string;
  vertical: string;
  match: string; // lowercase substring to match a brand name against
}

export const BRAND_VERTICALS: BrandVertical[] = [
  // Milk tea
  { brand: 'Chatime', category: 'Milk tea', vertical: 'fnb_cafe', match: 'chatime' },
  { brand: 'Macao Imperial Tea', category: 'Milk tea', vertical: 'fnb_cafe', match: 'macao imperial' },
  { brand: 'Gong Cha', category: 'Milk tea', vertical: 'fnb_cafe', match: 'gong cha' },
  { brand: 'CoCo Fresh Tea', category: 'Milk tea', vertical: 'fnb_cafe', match: 'coco' },
  { brand: 'Serenitea', category: 'Milk tea', vertical: 'fnb_cafe', match: 'serenitea' },
  // Coffee
  { brand: 'Starbucks', category: 'Coffee', vertical: 'fnb_cafe', match: 'starbucks' },
  { brand: 'Coffee Bean & Tea Leaf', category: 'Coffee', vertical: 'fnb_cafe', match: 'coffee bean' },
  { brand: 'Tim Hortons', category: 'Coffee', vertical: 'fnb_cafe', match: 'tim hortons' },
  // QSR
  { brand: 'Jollibee', category: 'QSR / fast food', vertical: 'fnb_qsr', match: 'jollibee' },
  { brand: "McDonald's", category: 'QSR / fast food', vertical: 'fnb_qsr', match: 'mcdonald' },
  { brand: 'KFC', category: 'QSR / fast food', vertical: 'fnb_qsr', match: 'kfc' },
  { brand: 'Chowking', category: 'Chinese QSR', vertical: 'fnb_qsr', match: 'chowking' },
  { brand: 'Mang Inasal', category: 'Grilled QSR', vertical: 'fnb_qsr', match: 'mang inasal' },
  // Bakery
  { brand: 'Red Ribbon', category: 'Bakery / dessert', vertical: 'fnb_bakery', match: 'red ribbon' },
  { brand: 'Goldilocks', category: 'Bakery / dessert', vertical: 'fnb_bakery', match: 'goldilocks' },
  // Pharmacy
  { brand: 'Mercury Drug', category: 'Pharmacy', vertical: 'pharmacy', match: 'mercury' },
  { brand: 'Watsons', category: 'Pharmacy', vertical: 'pharmacy', match: 'watsons' },
  // Convenience
  { brand: '7-Eleven', category: 'Convenience', vertical: 'convenience', match: '7-eleven' },
  { brand: 'Ministop', category: 'Convenience', vertical: 'convenience', match: 'ministop' },
  { brand: 'FamilyMart', category: 'Convenience', vertical: 'convenience', match: 'family mart' },
  // Fitness
  { brand: 'Anytime Fitness', category: 'Fitness', vertical: 'services_fitness', match: 'anytime fitness' },
  // Fuel
  { brand: 'Petron', category: 'Fuel', vertical: 'fuel', match: 'petron' },
  { brand: 'Shell', category: 'Fuel', vertical: 'fuel', match: 'shell' },
  // Remittance
  { brand: 'Cebuana Lhuillier', category: 'Remittance', vertical: 'remittance', match: 'cebuana' },
];

/** The vertical a brand maps to by name, or null if it isn't in the known list. */
export function verticalForBrand(brandName: string): string | null {
  const n = brandName.toLowerCase();
  return BRAND_VERTICALS.find((b) => n.includes(b.match))?.vertical ?? null;
}

/**
 * Derive a vertical from a franchisor's free-text `subCategory` (e.g. "QSR / grilled
 * chicken", "Milk tea / beverages", "Casual dining", "Pharmacy"). This is stored per
 * brand and is far more specific than the broad sector, so it lets EVERY seeded brand —
 * and any the user adds with a sensible sub-category — land in the right vertical
 * without hand-maintaining a name map. Returns null when nothing matches.
 */
export function verticalFromSubCategory(subCategory: string | null | undefined): string | null {
  if (!subCategory) return null;
  const s = subCategory.toLowerCase();
  // Order matters: check the most specific concepts first.
  if (/(milk\s*tea|bubble tea|beverage)/.test(s)) return 'fnb_cafe';
  if (/(coffee|caf[eé])/.test(s)) return 'fnb_cafe';
  if (/(bakery|dessert|pastr)/.test(s)) return 'fnb_bakery';
  if (/(qsr|fast food|fried chicken|grilled chicken|pizza|burger|snack|fries|chinese)/.test(s)) return 'fnb_qsr';
  if (/(casual dining|buffet|full-service|restaurant|dining)/.test(s)) return 'fnb_qsr';
  if (/(convenience|mini-?grocery|grocery)/.test(s)) return 'convenience';
  if (/(pharmacy|drugstore|drug)/.test(s)) return 'pharmacy';
  if (/(perfume|fragrance|cosmetic|beauty|personal care)/.test(s)) return 'retail_specialty';
  if (/(apparel|clothing)/.test(s)) return 'retail_apparel';
  if (/(book|specialty retail|health & beauty)/.test(s)) return 'retail_specialty';
  if (/(salon|barber|nail)/.test(s)) return 'services_salon';
  if (/(spa|wellness|aesthetic)/.test(s)) return 'services_spa';
  if (/(fitness|gym)/.test(s)) return 'services_fitness';
  if (/(laundr|laundromat)/.test(s)) return 'services_laundry';
  if (/(remittance|pawnshop|pawn|bills? payment|padala|money transfer)/.test(s)) return 'remittance';
  if (/(diagnostic|clinic|medical|laboratory|lab)/.test(s)) return 'diagnostics';
  if (/(fuel|petrol|gas station|lpg)/.test(s)) return 'fuel';
  if (/(automotive|auto service|auto\b)/.test(s)) return 'automotive';
  if (/(hotel|lodging|travel)/.test(s)) return 'hotel';
  if (/(review center|tutorial|education|school)/.test(s)) return 'education';
  if (/(water refilling|water station)/.test(s)) return 'convenience';
  if (/(courier|logistics|cargo|freight)/.test(s)) return 'other';
  if (/(repair|vulcaniz|locksmith|key duplicat)/.test(s)) return 'other';
  if (/(pet)/.test(s)) return 'other';
  return null;
}

/**
 * Best available vertical for a brand: its name in the curated map first (most reliable
 * for well-known chains), then its stored sub-category, else null (caller falls back to
 * the broad sector). One place so the API and the wizard agree.
 */
export function resolveBrandVertical(brandName: string, subCategory: string | null | undefined): string | null {
  return verticalForBrand(brandName) ?? verticalFromSubCategory(subCategory);
}

/**
 * The broad sector a vertical belongs to (matches Franchisor.sector). Kept in sync with
 * the mapping the intake API uses when it stores a franchisor's sector, so the brand
 * filter's sector fallback lines up with what's actually in the DB.
 */
export function sectorForVertical(vertical: string): 'FnB' | 'Retail' | 'Services' {
  if (vertical.startsWith('fnb_')) return 'FnB';
  if (vertical.startsWith('retail_') || vertical === 'convenience' || vertical === 'pharmacy') return 'Retail';
  return 'Services';
}
