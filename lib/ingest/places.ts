/**
 * Real-data pullers — persist REAL Philippine establishments (via Google Places New)
 * into the reference tables so BSA runs on a believable dataset instead of invented
 * demo rows.
 *
 * Discipline (mirrors lib/ingest/loaders.ts):
 *  - never fabricate a row — every outlet/POI/mall here is a real place Google returned;
 *  - classify Truth Layer honestly at the data layer: a real coordinate is Verified,
 *    but a chain's sales / a mall's footfall are NOT public → Assumed placeholders,
 *    clearly labelled, never passed off as Verified;
 *  - idempotent: upsert / find-then-write on a natural key so re-runs never duplicate;
 *  - cache-aware: the Places service caches 6h in-process, so re-pulls are cheap.
 *
 * All Google calls are server-side (GOOGLE_API_KEY). If the key is absent, the pullers
 * return empty reports rather than throwing, so a keyless environment still runs.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { textSearch, nearby, hasPlacesKey, type RealPlace } from '@/lib/places/placesService';
import { inPhBounds } from './normalize';
import type { PoiCategory, Sector, MallTier, FootfallBand } from '@prisma/client';

export interface PullReport {
  received: number;
  loaded: number;
  skipped: number;
  deduped: number;
}

const empty = (): PullReport => ({ received: 0, loaded: 0, skipped: 0, deduped: 0 });

/* ------------------------------------------------------------------------- *
 * Real brand catalog — the franchise networks we seed.                       *
 * Each entry is a real PH chain; queries drive Google text search per city.  *
 * `format` is the store format we tag outlets with; sales stay Assumed.      *
 * ------------------------------------------------------------------------- */
export interface BrandDef {
  slug: string;
  brandName: string;
  legalName?: string;
  sector: Sector;
  subCategory: string;
  positioning: string;
  /** Google text-search phrase (brand name); cities are appended per pull. */
  query: string;
  /** Store format tag applied to pulled outlets. */
  format: string;
  /** Vertical this brand demos (drives Territory Guard competitor pulls). */
  vertical: string;
  /** Demand cluster from the PFA Analysis workbook (2 - Data Intake) this brand covers. */
  cluster: string;
}

/**
 * Real PH franchise brands mapped to the 20 demand clusters in the PFA Analysis
 * workbook (2 - Data Intake / GPV-BSL-2026-DEMAND-GAP-001). Each cluster the
 * workbook lists is covered by ≥1 real brand so the DB carries a real outlet
 * network for every business type BSL serves. `cluster` ties each brand back to
 * the source taxonomy; `vertical` aligns to the Prisma Vertical enum.
 */
export const BRAND_CATALOG: BrandDef[] = [
  // 1. QSR / Food Cart / Kiosk (F&B, 58 brands) ------------------------------
  { slug: 'jollibee', brandName: 'Jollibee', legalName: 'Jollibee Foods Corporation', sector: 'FnB', subCategory: 'QSR / fast food', positioning: 'Market-leading Filipino QSR — fried chicken and value meals for families.', query: 'Jollibee', format: 'freestanding', vertical: 'fnb_qsr', cluster: 'QSR / Food Cart / Kiosk' },
  { slug: 'mcdonalds', brandName: "McDonald's", sector: 'FnB', subCategory: 'QSR / fast food', positioning: 'Global QSR — burgers and breakfast, drive-thru and mall formats.', query: "McDonald's", format: 'freestanding', vertical: 'fnb_qsr', cluster: 'QSR / Food Cart / Kiosk' },
  { slug: 'chowking', brandName: 'Chowking', sector: 'FnB', subCategory: 'QSR / Chinese-Filipino', positioning: 'Chinese-Filipino QSR — rice bowls, dim sum, and noodles.', query: 'Chowking', format: 'inline', vertical: 'fnb_qsr', cluster: 'QSR / Food Cart / Kiosk' },
  { slug: 'mang-inasal', brandName: 'Mang Inasal', sector: 'FnB', subCategory: 'QSR / grilled chicken', positioning: 'Grilled-chicken QSR with unlimited rice — value-led, mass market.', query: 'Mang Inasal', format: 'inline', vertical: 'fnb_qsr', cluster: 'QSR / Food Cart / Kiosk' },

  // 2. Casual / Full-Service Dining (F&B, 39 brands) -------------------------
  { slug: 'max-restaurant', brandName: 'Max’s Restaurant', sector: 'FnB', subCategory: 'Casual dining', positioning: 'Filipino casual-dining institution — fried chicken and family meals.', query: "Max's Restaurant", format: 'freestanding', vertical: 'fnb_qsr', cluster: 'Casual / Full-Service Dining' },
  { slug: 'vikings', brandName: 'Vikings Luxury Buffet', sector: 'FnB', subCategory: 'Casual dining / buffet', positioning: 'Large-format buffet dining — mall-anchored, high capital per site.', query: 'Vikings Luxury Buffet', format: 'mall', vertical: 'fnb_qsr', cluster: 'Casual / Full-Service Dining' },

  // 3. Beverage / Milk Tea Kiosk (F&B, 31 brands) ----------------------------
  { slug: 'chatime', brandName: 'Chatime', sector: 'FnB', subCategory: 'Milk tea / beverages', positioning: 'Global milk-tea chain — young urban professionals and students.', query: 'Chatime', format: 'kiosk', vertical: 'fnb_cafe', cluster: 'Beverage / Milk Tea Kiosk' },
  { slug: 'macao-imperial-tea', brandName: 'Macao Imperial Tea', legalName: 'Macao Imperial Tea Philippines', sector: 'FnB', subCategory: 'Milk tea / beverages', positioning: 'Premium milk-tea chain — signature cheese-tea for young urban professionals.', query: 'Macao Imperial Tea', format: 'inline', vertical: 'fnb_cafe', cluster: 'Beverage / Milk Tea Kiosk' },
  { slug: 'gong-cha', brandName: 'Gong Cha', sector: 'FnB', subCategory: 'Milk tea / beverages', positioning: 'Premium bubble-tea chain — mall and high-street kiosks.', query: 'Gong Cha', format: 'kiosk', vertical: 'fnb_cafe', cluster: 'Beverage / Milk Tea Kiosk' },

  // 4. Bakery / Dessert (F&B, 26 brands) -------------------------------------
  { slug: 'red-ribbon', brandName: 'Red Ribbon', sector: 'FnB', subCategory: 'Bakery / dessert', positioning: 'Bakeshop chain — cakes, pastries, and snacks for the neighbourhood.', query: 'Red Ribbon Bakeshop', format: 'inline', vertical: 'fnb_bakery', cluster: 'Bakery / Dessert' },
  { slug: 'goldilocks', brandName: 'Goldilocks', sector: 'FnB', subCategory: 'Bakery / dessert', positioning: 'Filipino bakeshop and eatery — repeat-purchase neighbourhood business.', query: 'Goldilocks', format: 'inline', vertical: 'fnb_bakery', cluster: 'Bakery / Dessert' },

  // 5. Apparel / Specialty Retail (Retail, 15 brands) ------------------------
  { slug: 'bench', brandName: 'Bench', sector: 'Retail', subCategory: 'Apparel', positioning: 'Filipino apparel and lifestyle retailer — mall-dependent floor position.', query: 'Bench store', format: 'mall', vertical: 'retail_apparel', cluster: 'Apparel / Specialty Retail' },
  { slug: 'penshoppe', brandName: 'Penshoppe', sector: 'Retail', subCategory: 'Apparel', positioning: 'Fast-fashion apparel — mall-tier and co-tenancy sensitive.', query: 'Penshoppe', format: 'mall', vertical: 'retail_apparel', cluster: 'Apparel / Specialty Retail' },

  // 6. Coffee Shop / Cafe (F&B, 12 brands) -----------------------------------
  { slug: 'starbucks', brandName: 'Starbucks', sector: 'FnB', subCategory: 'Coffee shop / cafe', positioning: 'Premium coffee — daypart-driven, CBD and lifestyle-mall formats.', query: 'Starbucks', format: 'inline', vertical: 'fnb_cafe', cluster: 'Coffee Shop / Cafe' },
  { slug: 'coffee-bean-tea-leaf', brandName: 'The Coffee Bean & Tea Leaf', sector: 'FnB', subCategory: 'Coffee shop / cafe', positioning: 'Dwell-time cafe — office and campus daypart mix.', query: 'Coffee Bean and Tea Leaf', format: 'inline', vertical: 'fnb_cafe', cluster: 'Coffee Shop / Cafe' },

  // 7. Pharmacy / Health Retail (Retail, 8 brands) ---------------------------
  { slug: 'mercury-drug', brandName: 'Mercury Drug', legalName: 'Mercury Drug Corporation', sector: 'Retail', subCategory: 'Pharmacy / drugstore', positioning: 'Dominant PH drugstore chain — pharmacy plus front-of-store retail.', query: 'Mercury Drug', format: 'inline', vertical: 'pharmacy', cluster: 'Pharmacy / Health Retail' },
  { slug: 'watsons', brandName: 'Watsons', sector: 'Retail', subCategory: 'Health & beauty', positioning: 'Health-and-beauty retail — pharmacy, personal care, cosmetics.', query: 'Watsons', format: 'mall', vertical: 'pharmacy', cluster: 'Pharmacy / Health Retail' },
  { slug: 'southstar-drug', brandName: 'Southstar Drug', sector: 'Retail', subCategory: 'Pharmacy / drugstore', positioning: 'Drugstore chain — proximity to clinics and lower-income catchments.', query: 'Southstar Drug', format: 'inline', vertical: 'pharmacy', cluster: 'Pharmacy / Health Retail' },

  // 8. Spa / Wellness / Aesthetics (Services, 8 brands) ----------------------
  { slug: 'nail-spa', brandName: 'Nail Spa', sector: 'Services', subCategory: 'Spa / wellness', positioning: 'Nail and wellness spa — upper-income, discovery-dependent catchments.', query: 'nail spa', format: 'mall', vertical: 'services_spa', cluster: 'Spa / Wellness / Aesthetics' },
  { slug: 'ace-water-spa', brandName: 'Ace Water Spa', sector: 'Services', subCategory: 'Spa / wellness', positioning: 'Hydrotherapy wellness spa — premium pricing, destination catchment.', query: 'Ace Water Spa', format: 'freestanding', vertical: 'services_spa', cluster: 'Spa / Wellness / Aesthetics' },

  // 9. Convenience / Grocery (Retail, 7 brands) ------------------------------
  { slug: '7-eleven', brandName: '7-Eleven', legalName: 'Philippine Seven Corporation', sector: 'Retail', subCategory: 'Convenience store', positioning: 'Largest PH convenience chain — 24/7 grab-and-go and services.', query: '7-Eleven', format: 'freestanding', vertical: 'convenience', cluster: 'Convenience / Grocery' },
  { slug: 'ministop', brandName: 'Ministop', sector: 'Retail', subCategory: 'Convenience store', positioning: 'Convenience chain with hot-food ready meals.', query: 'Ministop', format: 'inline', vertical: 'convenience', cluster: 'Convenience / Grocery' },
  { slug: 'alfamart', brandName: 'Alfamart', sector: 'Retail', subCategory: 'Mini-grocery', positioning: 'Neighbourhood mini-grocery — network expansion play.', query: 'Alfamart', format: 'inline', vertical: 'convenience', cluster: 'Convenience / Grocery' },

  // 10. Fuel / LPG (Services, 6 brands) --------------------------------------
  { slug: 'petron', brandName: 'Petron', legalName: 'Petron Corporation', sector: 'Services', subCategory: 'Fuel retail', positioning: 'Leading PH fuel retailer — forecourt plus convenience.', query: 'Petron gas station', format: 'freestanding', vertical: 'fuel', cluster: 'Fuel / LPG' },
  { slug: 'shell', brandName: 'Shell', sector: 'Services', subCategory: 'Fuel retail', positioning: 'Fuel retailer with Select convenience and food partners.', query: 'Shell gas station', format: 'freestanding', vertical: 'fuel', cluster: 'Fuel / LPG' },
  { slug: 'caltex', brandName: 'Caltex', sector: 'Services', subCategory: 'Fuel retail', positioning: 'Fuel retailer — forecourt and StarMart convenience.', query: 'Caltex gas station', format: 'freestanding', vertical: 'fuel', cluster: 'Fuel / LPG' },

  // 11. Salon / Barber / Nails (Services, 6 brands) --------------------------
  { slug: 'david-salon', brandName: 'David’s Salon', sector: 'Services', subCategory: 'Salon / barber', positioning: 'Salon chain — walkable residential catchment in the right income band.', query: "David's Salon", format: 'mall', vertical: 'services_salon', cluster: 'Salon / Barber / Nails' },
  { slug: 'bruno-barbers', brandName: 'Bruno’s Barbers', sector: 'Services', subCategory: 'Barber', positioning: 'Barbershop chain — repeat-visit local service.', query: "Bruno's Barbers", format: 'inline', vertical: 'services_salon', cluster: 'Salon / Barber / Nails' },

  // 12. Automotive Services (Retail, 5 brands) -------------------------------
  { slug: 'rapide', brandName: 'Rapide', sector: 'Retail', subCategory: 'Automotive service', positioning: 'Auto service centre — needs frontage and service-bay lot geometry.', query: 'Rapide auto service', format: 'freestanding', vertical: 'automotive', cluster: 'Automotive Services' },
  { slug: 'autoplus', brandName: 'AutoPlus', sector: 'Retail', subCategory: 'Automotive service', positioning: 'Auto parts and service — vehicle-traffic dependent.', query: 'AutoPlus Sportzentrium', format: 'freestanding', vertical: 'automotive', cluster: 'Automotive Services' },

  // 13. Laundry (Services, 4 brands) -----------------------------------------
  { slug: 'lava-lava', brandName: 'Lava Lava Laundry', sector: 'Services', subCategory: 'Laundry', positioning: 'Self-service laundry — renter and condo-household density play.', query: 'laundromat', format: 'inline', vertical: 'services_laundry', cluster: 'Laundry' },
  { slug: 'wash-express', brandName: 'Wash Express Laundry', sector: 'Services', subCategory: 'Laundry', positioning: 'Laundry shop — short-walking-radius catchment density.', query: 'laundry shop', format: 'inline', vertical: 'services_laundry', cluster: 'Laundry' },

  // 14. Health / Diagnostics (Services, 3 brands) ----------------------------
  { slug: 'hi-precision', brandName: 'Hi-Precision Diagnostics', sector: 'Services', subCategory: 'Diagnostics', positioning: 'Diagnostic labs — residential catchment plus clinic/hospital referral.', query: 'Hi-Precision Diagnostics', format: 'freestanding', vertical: 'diagnostics', cluster: 'Health / Diagnostics' },
  { slug: 'healthway', brandName: 'Healthway Medical', sector: 'Services', subCategory: 'Clinic / diagnostics', positioning: 'Multi-specialty clinic — mall-based, accessibility-driven patient volume.', query: 'Healthway clinic', format: 'mall', vertical: 'diagnostics', cluster: 'Health / Diagnostics' },

  // 15. Financial / Remittance (Services, 3 brands) --------------------------
  { slug: 'cebuana-lhuillier', brandName: 'Cebuana Lhuillier', sector: 'Services', subCategory: 'Remittance / pawnshop', positioning: 'Remittance and pawn network — footfall at markets and commercial strips.', query: 'Cebuana Lhuillier', format: 'inline', vertical: 'remittance', cluster: 'Financial / Remittance' },
  { slug: 'mlhuillier', brandName: 'M Lhuillier', sector: 'Services', subCategory: 'Remittance / pawnshop', positioning: 'Remittance and financial services — dense network, transport-node reliant.', query: 'M Lhuillier', format: 'inline', vertical: 'remittance', cluster: 'Financial / Remittance' },

  // 16. Hotel / Travel / Leisure (Services, 3 brands) ------------------------
  { slug: 'red-planet', brandName: 'Red Planet Hotels', sector: 'Services', subCategory: 'Hotel / lodging', positioning: 'Value hotel chain — business-district and transport-link demand.', query: 'Red Planet Hotel', format: 'freestanding', vertical: 'hotel', cluster: 'Hotel / Travel / Leisure' },
  { slug: 'go-hotels', brandName: 'Go Hotels', sector: 'Services', subCategory: 'Hotel / lodging', positioning: 'Budget hotel — tourism-flow and CBD activity driven.', query: 'Go Hotels', format: 'freestanding', vertical: 'hotel', cluster: 'Hotel / Travel / Leisure' },

  // 17. Education / Review Center (Services, 2 brands) ------------------------
  { slug: 'ahead-tutorial', brandName: 'AHEAD Tutorial & Review', sector: 'Services', subCategory: 'Review center', positioning: 'Review centre — student density and campus/transport proximity.', query: 'AHEAD review center', format: 'inline', vertical: 'education', cluster: 'Education / Review Center' },
  { slug: 'kumon', brandName: 'Kumon', sector: 'Services', subCategory: 'Tutorial / education', positioning: 'After-school learning centre — residential-and-school catchment.', query: 'Kumon center', format: 'inline', vertical: 'education', cluster: 'Education / Review Center' },

  // 18. Water Station / Refilling (Services, 2 brands) -----------------------
  { slug: 'aquabest', brandName: 'Aquabest', sector: 'Services', subCategory: 'Water refilling', positioning: 'Water refilling station — small-radius residential density business.', query: 'Aquabest water refilling', format: 'inline', vertical: 'other', cluster: 'Water Station / Refilling' },
  { slug: 'crystal-clear', brandName: 'Crystal Clear', sector: 'Services', subCategory: 'Water refilling', positioning: 'Water station — tight-radius household density and breakeven count.', query: 'water refilling station', format: 'inline', vertical: 'other', cluster: 'Water Station / Refilling' },

  // 19. Fitness (Services, 1 brand) ------------------------------------------
  { slug: 'golds-gym', brandName: "Gold's Gym", sector: 'Services', subCategory: 'Fitness', positioning: 'Full-service fitness club — large floorplate at a carryable rent.', query: "Gold's Gym", format: 'mall', vertical: 'services_fitness', cluster: 'Fitness' },
  { slug: 'anytime-fitness', brandName: 'Anytime Fitness', sector: 'Services', subCategory: 'Fitness', positioning: '24/7 gym — daytime working population and competitor-gym mapping.', query: 'Anytime Fitness', format: 'inline', vertical: 'services_fitness', cluster: 'Fitness' },

  // 20. Other / Uncategorized (Services, 3 brands) — repeatable standard ------
  { slug: 'national-book-store', brandName: 'National Book Store', sector: 'Retail', subCategory: 'Specialty retail', positioning: 'Bookstore and school-supplies retailer — mall and community formats.', query: 'National Book Store', format: 'mall', vertical: 'retail_specialty', cluster: 'Other / Uncategorized' },
];

/* ------------------------------------------------------------------------- *
 * NCR geography — cities for brand text search, and a grid for POI sweeps.    *
 * ------------------------------------------------------------------------- */
export const NCR_CITIES: string[] = [
  'Makati', 'Taguig BGC', 'Pasig', 'Quezon City', 'Manila', 'Mandaluyong',
  'Muntinlupa Alabang', 'Parañaque', 'Pasay', 'San Juan', 'Marikina', 'Caloocan',
];

/** Grid of NCR sweep centers (lat, lon, label) for nearby POI pulls. */
export const NCR_GRID: Array<{ lat: number; lon: number; label: string }> = [
  { lat: 14.5547, lon: 121.0244, label: 'Makati CBD' },
  { lat: 14.5507, lon: 121.0487, label: 'BGC' },
  { lat: 14.5866, lon: 121.0614, label: 'Ortigas' },
  { lat: 14.6349, lon: 121.0388, label: 'QC Cubao' },
  { lat: 14.6537, lon: 121.0685, label: 'QC Katipunan' },
  { lat: 14.6091, lon: 120.9899, label: 'Manila España' },
  { lat: 14.5764, lon: 120.9822, label: 'Manila Ermita' },
  { lat: 14.5378, lon: 121.0014, label: 'Pasay MOA' },
  { lat: 14.4791, lon: 121.0198, label: 'Alabang' },
  { lat: 14.4793, lon: 121.0093, label: 'Parañaque BF' },
  { lat: 14.5794, lon: 121.0359, label: 'Mandaluyong' },
  { lat: 14.6507, lon: 121.1029, label: 'Marikina' },
];

/* ------------------------------------------------------------------------- *
 * Region XI (Davao) geography — grid + mall queries for the Davao POI sweep. *
 * ------------------------------------------------------------------------- */
export const DAVAO_CITIES: string[] = [
  'Davao City', 'Tagum', 'Digos', 'Panabo', 'Mati Davao Oriental', 'Samal Davao',
];

/** Grid of Davao-region sweep centers for nearby POI / healthcare pulls. */
export const DAVAO_GRID: Array<{ lat: number; lon: number; label: string }> = [
  { lat: 7.0639, lon: 125.6083, label: 'Davao Downtown (San Pedro/Claveria)' },
  { lat: 7.1000, lon: 125.6450, label: 'Davao Lanang (SM Lanang/Damosa)' },
  { lat: 7.0850, lon: 125.6130, label: 'Davao Bajada (JP Laurel/Abreeza)' },
  { lat: 7.0600, lon: 125.5950, label: 'Davao Matina' },
  { lat: 7.1050, lon: 125.6150, label: 'Davao Buhangin' },
  { lat: 7.0500, lon: 125.5700, label: 'Davao Talomo/Ecoland' },
  { lat: 7.4468, lon: 125.8095, label: 'Tagum City' },
  { lat: 6.7443, lon: 125.3565, label: 'Digos City' },
  { lat: 7.3004, lon: 125.6826, label: 'Panabo City' },
  { lat: 6.9614, lon: 126.2147, label: 'Mati City' },
  { lat: 7.0744, lon: 125.7086, label: 'Samal (IGACOS)' },
];

/** Mall text-search queries for the Davao region (already region-qualified). */
export const DAVAO_MALL_QUERIES: string[] = [
  'shopping mall in Davao City', 'SM Lanang Premier Davao', 'Abreeza Ayala Mall Davao',
  'SM City Davao Ecoland', 'Gaisano Mall Davao', 'NCCC Mall Davao',
  'shopping mall in Tagum City', 'shopping mall in Digos City', 'Gaisano Grand Panabo',
];

/* ------------------------------------------------------------------------- *
 * Franchisors + their real outlets.                                          *
 * ------------------------------------------------------------------------- */

/**
 * Deterministic, valid UUID per brand slug so re-runs upsert the same franchisor
 * row. Builds 32 hex digits from a stable hash of the slug, then formats as a
 * v4-shaped UUID (version nibble 4, variant nibble 8). No randomness → idempotent.
 */
export function brandUuid(slug: string): string {
  // FNV-1a-style rolling hash, expanded to 32 hex chars via four seeds.
  const digitsFrom = (seed: number): string => {
    let h = seed >>> 0;
    for (let i = 0; i < slug.length; i++) {
      h ^= slug.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };
  const hex = (digitsFrom(0x811c9dc5) + digitsFrom(0x1234abcd) + digitsFrom(0xdeadbeef) + digitsFrom(0xcafebabe)).slice(0, 32);
  const v = hex.slice(0, 12) + '4' + hex.slice(13, 16) + '8' + hex.slice(17, 32);
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20, 32)}`;
}

/**
 * Pull one brand's real outlets across NCR and persist franchisor + outlet rows.
 * Sales/performance stay Assumed (not public). Coordinates are Verified (Google).
 */
export async function pullBrand(brand: BrandDef, opts: { cities?: string[]; perCity?: number } = {}): Promise<PullReport> {
  if (!hasPlacesKey()) return empty();
  const cities = opts.cities ?? NCR_CITIES;
  const perCity = opts.perCity ?? 8;
  const franchisorId = brandUuid(brand.slug);

  // Upsert the franchisor.
  await prisma.franchisor.upsert({
    where: { id: franchisorId },
    update: { brandName: brand.brandName, legalName: brand.legalName, sector: brand.sector, subCategory: brand.subCategory, positioning: brand.positioning },
    create: { id: franchisorId, brandName: brand.brandName, legalName: brand.legalName, sector: brand.sector, subCategory: brand.subCategory, positioning: brand.positioning },
  });

  // Gather real outlets across cities, dedup on rounded coordinate.
  const seen = new Set<string>();
  const outlets: RealPlace[] = [];
  let received = 0;
  let deduped = 0;
  for (const city of cities) {
    const found = await textSearch(`${brand.query} ${city}`, { max: perCity });
    for (const p of found) {
      received++;
      if (!inPhBounds(p.lat, p.lon)) continue;
      // Guard against text search returning unrelated places: require brand token in name.
      if (!nameMatchesBrand(p.name, brand.brandName)) continue;
      const key = `${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`;
      if (seen.has(key)) { deduped++; continue; }
      seen.add(key);
      outlets.push(p);
    }
  }

  // Idempotent: clear this brand's outlets then insert the fresh real set.
  await prisma.outlet.deleteMany({ where: { franchisorId } });
  let loaded = 0;
  for (const p of outlets) {
    await prisma.outlet.create({
      data: {
        franchisorId,
        outletName: p.name,
        format: brand.format,
        status: 'open',
        lat: p.lat,
        lon: p.lon,
        // Sales/performance are NOT public → left null / Assumed. We do not invent figures.
        truthLayer: 'assumed',
      },
    });
    loaded++;
  }
  return { received, loaded, skipped: received - outlets.length - deduped, deduped };
}

function nameMatchesBrand(name: string, brand: string): boolean {
  const n = name.toLowerCase();
  // First significant token of the brand (e.g. "Mercury" from "Mercury Drug").
  const token = brand.toLowerCase().split(/[\s']/)[0];
  return n.includes(token) || n.includes(brand.toLowerCase());
}

/* ------------------------------------------------------------------------- *
 * Competitor & anchor POI sweep across the NCR grid.                         *
 * ------------------------------------------------------------------------- */

/** Google primaryType → our PoiCategory. */
function categoryForType(primaryType: string | null): PoiCategory {
  const t = (primaryType ?? '').toLowerCase();
  if (/hospital/.test(t)) return 'hospital';
  if (/(clinic|doctor|dentist|physio|medical_lab|drugstore|pharmacy)/.test(t)) return 'clinic';
  if (/(diagnostic|laboratory)/.test(t)) return 'diagnostic';
  if (/(shopping_mall|department_store)/.test(t)) return 'mall';
  if (/(school|university|primary_school|secondary_school)/.test(t)) return 'school';
  if (/(transit|train_station|bus_station|subway|light_rail)/.test(t)) return 'transport';
  if (/(corporate_office|office)/.test(t)) return 'office';
  return 'competitor';
}

/** Google types to sweep for POI (a broad but relevant NCR anchor/competitor set). */
const POI_SWEEP_TYPES: Array<{ types: string[]; tag: string }> = [
  { types: ['cafe', 'coffee_shop'], tag: 'cafe' },
  { types: ['fast_food_restaurant', 'restaurant'], tag: 'food' },
  { types: ['convenience_store'], tag: 'convenience' },
  { types: ['pharmacy', 'drugstore'], tag: 'pharmacy' },
  { types: ['gas_station'], tag: 'fuel' },
  { types: ['gym', 'fitness_center'], tag: 'gym' },
  { types: ['bank'], tag: 'bank' },
  { types: ['supermarket', 'grocery_store'], tag: 'grocery' },
  { types: ['school', 'university'], tag: 'school' },
  { types: ['transit_station', 'train_station', 'bus_station'], tag: 'transport' },
];

/** Sweep the NCR grid for real POIs and persist them (find-then-write, idempotent). */
export async function pullPoiSweep(opts: { grid?: typeof NCR_GRID; radiusM?: number; perCell?: number } = {}): Promise<PullReport> {
  if (!hasPlacesKey()) return empty();
  const grid = opts.grid ?? NCR_GRID;
  const radiusM = opts.radiusM ?? 1500;
  const perCell = opts.perCell ?? 20;

  const seen = new Set<string>();
  let received = 0;
  let deduped = 0;
  let loaded = 0;
  let skipped = 0;

  for (const cell of grid) {
    for (const sweep of POI_SWEEP_TYPES) {
      const found = await nearby(cell.lat, cell.lon, sweep.types, `sweep:${sweep.tag}`, { radiusM, max: perCell });
      for (const p of found) {
        received++;
        if (!inPhBounds(p.lat, p.lon)) { skipped++; continue; }
        const key = `${p.name.toLowerCase()}:${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`;
        if (seen.has(key)) { deduped++; continue; }
        seen.add(key);
        const category = categoryForType(p.primaryType);
        // Idempotent on (name, rounded coord): find-then-write (POI has no natural unique here).
        const existing = await prisma.poi.findFirst({
          where: { name: p.name, lat: { gte: p.lat - 1e-4, lte: p.lat + 1e-4 }, lon: { gte: p.lon - 1e-4, lte: p.lon + 1e-4 } },
          select: { id: true },
        });
        const data = { name: p.name, category, lat: p.lat, lon: p.lon, city: cell.label, source: 'manual' as const, truthLayer: 'verified' as const };
        if (existing) await prisma.poi.update({ where: { id: existing.id }, data });
        else await prisma.poi.create({ data });
        loaded++;
      }
    }
  }
  return { received, loaded, skipped, deduped };
}

/* ------------------------------------------------------------------------- *
 * Malls — real SM / Ayala / Robinsons / Megaworld properties.                *
 * ------------------------------------------------------------------------- */

const MALL_QUERIES: string[] = [
  'SM Supermalls', 'Ayala Malls', 'Robinsons Malls', 'Megaworld Lifestyle Malls', 'Gateway Mall',
];

/** Infer a tier from the brand + name (documented heuristic; footfall Assumed). */
function inferMallTier(name: string): MallTier {
  const n = name.toLowerCase();
  // Flagship/super-regional → A; mid → B; small/community → C.
  if (/(mega|moa|mall of asia|aura|glorietta|greenbelt|trinoma|north edsa|megamall|ayala center)/.test(n)) return 'A';
  if (/(sm|ayala|robinsons|gateway|market!|uptown|festival|alabang town)/.test(n)) return 'B';
  return 'C';
}
function footfallForTier(tier: MallTier): FootfallBand {
  return tier === 'A' ? 'very_high' : tier === 'B' ? 'high' : 'medium';
}

/**
 * Stable identity for a mall — strips the city/address suffix Google appends
 * ("SM Megamall, Mandaluyong" → "sm megamall") so name variants of the same
 * property collapse to one row across pulls.
 */
export function normalizeMallName(name: string): string {
  return name
    .toLowerCase()
    .split(',')[0] // drop ", City, Metro Manila" tail
    .replace(/\b(mall|supermall|the)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Pull real malls and persist mall_property rows (find-then-write on name).
 * `regionSuffix` is appended to each query to disambiguate location (defaults to
 * "Metro Manila" for the NCR query set); pass "" for queries that already name
 * their region (e.g. the Davao query set).
 */
export async function pullMalls(opts: { queries?: string[]; perQuery?: number; regionSuffix?: string } = {}): Promise<PullReport> {
  if (!hasPlacesKey()) return empty();
  const queries = opts.queries ?? MALL_QUERIES;
  const perQuery = opts.perQuery ?? 20;
  const regionSuffix = opts.regionSuffix ?? 'Metro Manila';

  const seen = new Set<string>();
  let received = 0;
  let deduped = 0;
  let loaded = 0;
  let skipped = 0;

  for (const q of queries) {
    const found = await textSearch(regionSuffix ? `${q} ${regionSuffix}` : q, { max: perQuery });
    for (const p of found) {
      received++;
      if (!inPhBounds(p.lat, p.lon)) { skipped++; continue; }
      const norm = normalizeMallName(p.name);
      if (!norm) { skipped++; continue; }
      if (seen.has(norm)) { deduped++; continue; }
      seen.add(norm);
      const tier = inferMallTier(p.name);
      // Idempotent across name variants: fetch candidates sharing the first token or
      // sitting within ~110 m, then match on the normalized name so "SM Megamall" and
      // "SM Megamall, Mandaluyong" resolve to the same row.
      const firstToken = norm.split(' ')[0];
      const candidates = await prisma.mallProperty.findMany({
        where: {
          OR: [
            { mallName: { contains: firstToken, mode: 'insensitive' } },
            { lat: { gte: p.lat - 1e-3, lte: p.lat + 1e-3 }, lon: { gte: p.lon - 1e-3, lte: p.lon + 1e-3 } },
          ],
        },
        select: { id: true, mallName: true },
      });
      const existing = candidates.find((c) => normalizeMallName(c.mallName) === norm) ?? null;
      const data = {
        mallName: p.name,
        city: cityFromAddress(p.address),
        tier,
        footfallBand: footfallForTier(tier),
        lat: p.lat,
        lon: p.lon,
        // Coordinate + tier (from brand) recorded; footfall band is inferred → Assumed.
        truthLayer: 'assumed' as const,
      };
      if (existing) await prisma.mallProperty.update({ where: { id: existing.id }, data });
      else await prisma.mallProperty.create({ data });
      loaded++;
    }
  }
  return { received, loaded, skipped, deduped };
}

/* ------------------------------------------------------------------------- *
 * Healthcare facilities → poi (hospital/clinic/diagnostic).                  *
 * ------------------------------------------------------------------------- */

const HEALTH_TYPES = ['hospital', 'doctor', 'medical_lab', 'dentist', 'physiotherapist'];

export async function pullHealthcare(opts: { grid?: typeof NCR_GRID; radiusM?: number; perCell?: number } = {}): Promise<PullReport> {
  if (!hasPlacesKey()) return empty();
  const grid = opts.grid ?? NCR_GRID;
  const radiusM = opts.radiusM ?? 2000;
  const perCell = opts.perCell ?? 20;

  const seen = new Set<string>();
  let received = 0;
  let deduped = 0;
  let loaded = 0;
  let skipped = 0;

  for (const cell of grid) {
    const found = await nearby(cell.lat, cell.lon, HEALTH_TYPES, 'sweep:health', { radiusM, max: perCell });
    for (const p of found) {
      received++;
      if (!inPhBounds(p.lat, p.lon)) { skipped++; continue; }
      const key = `${p.name.toLowerCase()}:${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`;
      if (seen.has(key)) { deduped++; continue; }
      seen.add(key);
      const category = categoryForType(p.primaryType) === 'competitor' ? 'clinic' : categoryForType(p.primaryType);
      const existing = await prisma.poi.findFirst({
        where: { name: p.name, lat: { gte: p.lat - 1e-4, lte: p.lat + 1e-4 }, lon: { gte: p.lon - 1e-4, lte: p.lon + 1e-4 } },
        select: { id: true },
      });
      const data = { name: p.name, category: category as PoiCategory, lat: p.lat, lon: p.lon, city: cell.label, source: 'manual' as const, truthLayer: 'verified' as const };
      if (existing) await prisma.poi.update({ where: { id: existing.id }, data });
      else await prisma.poi.create({ data });
      loaded++;
    }
  }
  return { received, loaded, skipped, deduped };
}

/** Pull a city name out of a Google formatted address (best-effort). */
function cityFromAddress(address: string | null): string | null {
  if (!address) return null;
  // "…, Makati, 1200 Metro Manila, Philippines" → "Makati"
  const parts = address.split(',').map((s) => s.trim());
  const metroIdx = parts.findIndex((p) => /metro manila/i.test(p));
  if (metroIdx > 0) return parts[metroIdx - 1].replace(/\d{4}\s*/, '').trim() || null;
  return parts.length >= 3 ? parts[parts.length - 3] : null;
}
