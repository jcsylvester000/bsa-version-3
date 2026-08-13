/**
 * OSM (Overpass) ingestion — Google-free NCR POI + brand-branch sweep.
 *
 *   npm run db:ingest:osm                 # full NCR sweep (competitors + brand branches)
 *   npm run db:ingest:osm -- --quick      # 3 verticals, brands only — fast smoke test
 *   npm run db:ingest:osm -- --competitors # competitor sweep only
 *   npm run db:ingest:osm -- --brands     # brand-branch pull only
 *
 * Sources real Metro Manila establishments from OpenStreetMap via the public Overpass
 * API — no key, no billing. Writes into the `poi` table through the existing loadPoi
 * loader (idempotent upsert on osm_id). Coordinates are Verified; category is mapped
 * from the OSM tag. This is the DB-only competitor + saturation dataset the app reads
 * at runtime.
 *
 * Politeness: Overpass is a shared free resource. The osmService already sleeps between
 * calls and rotates/retries endpoints; here we additionally run strictly sequentially.
 */
import 'dotenv/config';
import { loadPoi } from '../lib/ingest/loaders';
import type { RawPoi } from '../lib/ingest/normalize';
import {
  establishmentsInBbox,
  brandBranchesInBbox,
  osmTagToPoiCategory,
  NCR_BBOX,
  type OsmPlace,
} from '../lib/places/osmService';

// Verticals we sweep for competitor density across NCR. (The full set the app scores on.)
const SWEEP_VERTICALS = [
  'fnb_qsr', 'fnb_cafe', 'fnb_bakery', 'convenience', 'pharmacy',
  'services_salon', 'services_spa', 'services_fitness', 'services_laundry',
  'remittance', 'education', 'retail_apparel', 'retail_specialty', 'fuel',
];

// Brands whose NCR branches we map (drives saturation / white-space). Sourced from the
// franchise-intelligence catalog — the well-known chains OSM is most likely to have tagged.
const BRAND_PULL = [
  'Jollibee', 'Mang Inasal', 'Chowking', 'Greenwich', 'KFC', 'McDonald', 'Bonchon',
  'Mercury Drug', 'The Generics Pharmacy', 'Watsons', 'Rose Pharmacy', 'South Star Drug',
  '7-Eleven', 'Ministop', 'FamilyMart', 'Alfamart', 'Uncle John',
  'Starbucks', 'Chatime', 'Gong Cha', 'CoCo', 'Serenitea', 'Macao Imperial Tea', 'Coffee Bean',
  'Red Ribbon', 'Goldilocks', 'Julie', 'Figaro',
  'David\'s Salon', 'Bruno', 'Lay Bare', 'Posh Nails',
  'Anytime Fitness', 'Gold\'s Gym', 'Petron', 'Shell', 'Caltex',
  'Palawan', 'Cebuana', 'LBC', 'M Lhuillier',
];

interface Args { quick: boolean; competitors: boolean; brands: boolean; }

function parseArgs(argv: string[]): Args {
  const a: Args = { quick: false, competitors: false, brands: false };
  for (const x of argv) {
    if (x === '--quick') a.quick = true;
    else if (x === '--competitors') a.competitors = true;
    else if (x === '--brands') a.brands = true;
  }
  // If neither flag is set, do both.
  if (!a.competitors && !a.brands) { a.competitors = true; a.brands = true; }
  return a;
}

/** OsmPlace → RawPoi (loadPoi input). Category from the OSM tag; source stays 'osm'. */
function toRawPoi(p: OsmPlace, categoryOverride?: string): RawPoi {
  return {
    osm_id: p.osmId,
    name: p.name,
    category: categoryOverride ?? osmTagToPoiCategory(p.osmTag),
    lat: p.lat,
    lon: p.lon,
    city: null, // barangay/city snap is a later enhancement; coord is what matters here
    barangay: null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`OSM (Overpass) NCR ingest — competitors:${args.competitors} brands:${args.brands} quick:${args.quick}`);
  console.log('Source: OpenStreetMap via public Overpass API (no key, no billing).\n');

  let totalLoaded = 0;
  const failed: string[] = [];
  const pause = () => new Promise((r) => setTimeout(r, 2500)); // breathe between items — kinder to public Overpass

  // --- 1. Competitor density sweep, per vertical, across the NCR bbox ---------
  if (args.competitors) {
    const verticals = args.quick ? SWEEP_VERTICALS.slice(0, 3) : SWEEP_VERTICALS;
    console.log(`[1] Competitor sweep — ${verticals.length} verticals across NCR…`);
    for (const v of verticals) {
      try {
        const places = await establishmentsInBbox(v, NCR_BBOX, { max: args.quick ? 150 : 600 });
        const rows = places.map((p) => toRawPoi(p, 'competitor'));
        const rep = await loadPoi(rows);
        totalLoaded += rep.loaded;
        console.log(`   ${v}: ${places.length} found → ${rep.loaded} loaded (${rep.deduped} dedup, ${rep.skipped} skip)`);
      } catch (e) {
        failed.push(`vertical:${v}`);
        console.log(`   ${v}: FAILED — ${e instanceof Error ? e.message : e}`);
      }
      await pause();
    }
  }

  // --- 2. Brand-branch pull, per brand, across the NCR bbox ------------------
  if (args.brands) {
    const brands = args.quick ? BRAND_PULL.slice(0, 5) : BRAND_PULL;
    console.log(`\n[2] Brand-branch pull — ${brands.length} brands across NCR…`);
    for (const b of brands) {
      try {
        const places = await brandBranchesInBbox(b, NCR_BBOX, { max: 200 });
        const rows = places.map((p) => toRawPoi(p, 'competitor'));
        const rep = await loadPoi(rows);
        totalLoaded += rep.loaded;
        console.log(`   ${b}: ${places.length} found → ${rep.loaded} loaded`);
      } catch (e) {
        failed.push(`brand:${b}`);
        console.log(`   ${b}: FAILED — ${e instanceof Error ? e.message : e}`);
      }
      await pause();
    }
  }

  console.log(`\nOSM ingest complete — ${totalLoaded} POI rows loaded/updated.`);
  if (failed.length) {
    console.log(`\n${failed.length} item(s) failed (public Overpass rate-limits): ${failed.join(', ')}`);
    console.log('These are pre-warm only — the on-demand cache fills them on the first report over that area.');
    console.log('You can re-run any time (idempotent); a quieter hour usually clears the 504s.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(async () => {
    const { prisma } = await import('@/lib/db/prisma');
    await prisma.$disconnect();
  });
