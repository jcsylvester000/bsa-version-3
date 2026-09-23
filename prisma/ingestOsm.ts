/**
 * OSM (Overpass) ingestion — Google-free POI + brand-branch sweep, region-aware (R-01) and
 * complete via adaptive tiling (R-03).
 *
 *   npm run db:ingest:osm                          # full NCR sweep (tiled competitors + brands)
 *   npm run db:ingest:osm -- --region=cavite       # a whole province, complete (no truncation)
 *   npm run db:ingest:osm:cavite / :batangas       # shortcuts
 *   npm run db:ingest:osm -- --quick               # fast single-bbox smoke (may truncate)
 *   npm run db:ingest:osm -- --competitors|--brands# one phase only
 *   npm run db:ingest:osm -- --region=cavite --force# ignore the resumable checkpoint, re-sweep
 *
 * Sources real establishments from OpenStreetMap via the public Overpass API — no key, no billing.
 * Writes into `poi` through loadPoi (idempotent upsert on osm_id); coordinates Verified, region
 * tagged. The DEFAULT competitor sweep tiles the region and splits any tile that hits the query
 * cap, so dense verticals are captured fully instead of cut off at `out center N`. Each start-tile
 * is checkpointed in poi_coverage (source='bulk'), so an interrupted run resumes; --force re-sweeps.
 *
 * Politeness: Overpass is a shared free resource (guideline ~10k queries/day). osmService sleeps
 * between calls and rotates endpoints; this script runs strictly sequentially with extra pauses.
 */
import 'dotenv/config';
import { loadPoi } from '../lib/ingest/loaders';
import type { RawPoi } from '../lib/ingest/normalize';
import { getRegion, type RegionKey, REGION_KEYS } from '../lib/geo/regions';
import { prisma } from '@/lib/db/prisma';
import { bboxKey, bboxCentre, type BBox } from '@/lib/geo/tiling';
import {
  establishmentsInBbox,
  establishmentsInTiles,
  brandBranchesInBbox,
  osmTagToPoiCategory,
  type OsmPlace,
} from '../lib/places/osmService';

// Categories we sweep for competitor density across NCR. Covers ALL industries the app scores
// on — F&B, the full retail spread (apparel, specialty, grocery/supermarket, hardware,
// electronics), convenience, pharmacy/diagnostics, every service format, fuel/automotive,
// hospitality and education — not just F&B. Each key maps to OSM tag selectors in osmService.
const SWEEP_VERTICALS = [
  // Food & beverage
  'fnb_qsr', 'fnb_cafe', 'fnb_bakery',
  // Retail (broadened well beyond F&B)
  'retail_apparel', 'retail_specialty', 'grocery', 'hardware', 'electronics', 'convenience',
  // Health & beauty
  'pharmacy', 'diagnostics', 'services_salon', 'services_spa',
  // Services
  'services_fitness', 'services_laundry', 'remittance', 'education',
  // Land-intensive / hospitality
  'fuel', 'automotive', 'hotel',
];

// Brands whose NCR branches we map (drives saturation / white-space). Sourced from the
// franchise-intelligence catalog — the well-known chains OSM is most likely to have tagged.
// Spans every covered industry so brand branches exist for non-F&B verticals too.
const BRAND_PULL = [
  // QSR / casual dining
  'Jollibee', 'Mang Inasal', 'Chowking', 'Greenwich', 'KFC', 'McDonald', 'Bonchon',
  'Max\'s', 'Yellow Cab', 'Shakey', 'Pizza Hut', 'Army Navy', 'Potato Corner',
  // Coffee / milk tea / bakery / dessert
  'Starbucks', 'Chatime', 'Gong Cha', 'CoCo', 'Serenitea', 'Macao Imperial Tea', 'Coffee Bean',
  'Bo\'s Coffee', 'Tim Hortons', 'Dunkin', 'Mister Donut', 'Krispy Kreme', 'J.CO',
  'Red Ribbon', 'Goldilocks', 'Julie', 'Figaro',
  // Pharmacy / health / diagnostics
  'Mercury Drug', 'The Generics Pharmacy', 'Watsons', 'Rose Pharmacy', 'South Star Drug', 'Generika',
  'Hi-Precision', 'Healthway',
  // Convenience
  '7-Eleven', 'Ministop', 'FamilyMart', 'Alfamart', 'Uncle John', 'Lawson',
  // Grocery / supermarket / warehouse
  'SM Supermarket', 'Savemore', 'Puregold', 'Robinsons Supermarket', 'WalterMart', 'Landers',
  'S&R', 'Rustan', 'Shopwise', 'Metro Supermarket',
  // Apparel / specialty / department / electronics / hardware retail
  'Uniqlo', 'Penshoppe', 'Bench', 'Oxygen', 'National Book Store', 'Ace Hardware', 'Wilcon',
  'Handyman', 'Abenson', 'Automatic Centre',
  // Salon / spa / fitness / laundry
  'David\'s Salon', 'Bruno', 'Lay Bare', 'Posh Nails', 'Nuat Thai', 'Ace Water Spa',
  'Anytime Fitness', 'Gold\'s Gym', 'Fitness First', 'Slimmers World',
  // Fuel / automotive
  'Petron', 'Shell', 'Caltex', 'Seaoil', 'Phoenix', 'Rapide', 'Ziebart',
  // Remittance / courier
  'Palawan', 'Cebuana', 'LBC', 'M Lhuillier', 'J&T',
  // Hotels / education
  'Go Hotels', 'Red Planet', 'RedDoorz', 'Kumon',
];

interface Args { quick: boolean; competitors: boolean; brands: boolean; region: RegionKey; force: boolean; }

function parseArgs(argv: string[]): Args {
  const a: Args = { quick: false, competitors: false, brands: false, region: 'ncr', force: false };
  for (const x of argv) {
    if (x === '--quick') a.quick = true;
    else if (x === '--competitors') a.competitors = true;
    else if (x === '--brands') a.brands = true;
    else if (x === '--force') a.force = true;
    else if (x.startsWith('--region=')) {
      const r = x.slice('--region='.length) as RegionKey;
      if (REGION_KEYS.includes(r)) a.region = r;
      else { console.error(`Unknown --region=${r}; use one of ${REGION_KEYS.join(', ')}`); process.exit(1); }
    }
  }
  // If neither flag is set, do both.
  if (!a.competitors && !a.brands) { a.competitors = true; a.brands = true; }
  return a;
}

/** OsmPlace → RawPoi (loadPoi input). Category from the OSM tag; source stays 'osm'. */
function toRawPoi(p: OsmPlace, region: RegionKey, categoryOverride?: string): RawPoi {
  return {
    osm_id: p.osmId,
    name: p.name,
    category: categoryOverride ?? osmTagToPoiCategory(p.osmTag),
    lat: p.lat,
    lon: p.lon,
    city: null, // barangay/city snap lands with R-02 boundaries; coord is what matters here
    barangay: null,
    region, // the whole sweep is within one region
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const region = getRegion(args.region)!;
  const REGION_BBOX = region.bbox;
  console.log(`OSM (Overpass) ${region.name} ingest — competitors:${args.competitors} brands:${args.brands} quick:${args.quick}`);
  console.log('Source: OpenStreetMap via public Overpass API (no key, no billing).');
  console.log('Note: single-bbox sweep is capped and can truncate dense verticals — the tiled sweep (R-03) is the complete path.\n');

  let totalLoaded = 0;
  const failed: string[] = [];
  const pause = () => new Promise((r) => setTimeout(r, 2500)); // breathe between items — kinder to public Overpass

  // --- 1. Competitor density sweep, per vertical, across the NCR bbox ---------
  if (args.competitors) {
    const verticals = args.quick ? SWEEP_VERTICALS.slice(0, 3) : SWEEP_VERTICALS;
    if (args.quick) {
      // Fast smoke: one capped bbox query per vertical (may truncate — that's fine for --quick).
      console.log(`[1] Competitor sweep (quick, single-bbox) — ${verticals.length} verticals across ${region.name}…`);
      for (const v of verticals) {
        try {
          const places = await establishmentsInBbox(v, REGION_BBOX, { max: 150 });
          const rep = await loadPoi(places.map((p) => toRawPoi(p, args.region, 'competitor')));
          totalLoaded += rep.loaded;
          console.log(`   ${v}: ${places.length} found → ${rep.loaded} loaded`);
        } catch (e) { failed.push(`vertical:${v}`); console.log(`   ${v}: FAILED — ${e instanceof Error ? e.message : e}`); }
        await pause();
      }
    } else {
      // Complete tiled sweep (R-03): adaptive quad-tiling, resumable per start-tile via poi_coverage
      // (source='bulk'). No truncation — a dense tile splits until every establishment is captured.
      console.log(`[1] Competitor sweep (tiled, complete) — ${verticals.length} verticals across ${region.name}…`);
      for (const v of verticals) {
        try {
          const stats = await establishmentsInTiles(v, REGION_BBOX, {
            max: 400,
            shouldProcess: async (tile) => {
              if (args.force) return true;
              const cov = await prisma.poiCoverage.findUnique({
                where: { coverage_cell_vertical: { cellKey: `bulk:${bboxKey(tile as BBox)}`, vertical: v } },
                select: { source: true },
              });
              return !(cov && cov.source === 'bulk'); // skip start-tiles already bulk-covered
            },
            onStartTileDone: async (tile, places, info) => {
              // Always load what we captured; only checkpoint the tile as done when it fully
              // succeeded, so a tile with an Overpass failure inside is retried on the next run.
              const rep = await loadPoi(places.map((p) => toRawPoi(p, args.region, 'competitor')));
              totalLoaded += rep.loaded;
              if (!info.complete) return;
              const c = bboxCentre(tile as BBox);
              await prisma.poiCoverage.upsert({
                where: { coverage_cell_vertical: { cellKey: `bulk:${bboxKey(tile as BBox)}`, vertical: v } },
                update: { lat: c.lat, lon: c.lon, poiCount: places.length, fetchedAt: new Date(), source: 'bulk' },
                create: { cellKey: `bulk:${bboxKey(tile as BBox)}`, vertical: v, lat: c.lat, lon: c.lon, poiCount: places.length, source: 'bulk' },
              });
            },
          });
          const warn = stats.failedTiles > 0 ? ` — ${stats.failedTiles} tile(s) hit Overpass errors and will retry on the next run` : '';
          console.log(`   ${v}: ${stats.processed}/${stats.startTiles} tiles (${stats.skipped} skipped, ${stats.splits} splits) → ${stats.total} establishments${warn}`);
        } catch (e) { failed.push(`vertical:${v}`); console.log(`   ${v}: FAILED — ${e instanceof Error ? e.message : e}`); }
        await pause();
      }
    }
  }

  // --- 2. Brand-branch pull, per brand, across the NCR bbox ------------------
  if (args.brands) {
    const brands = args.quick ? BRAND_PULL.slice(0, 5) : BRAND_PULL;
    console.log(`\n[2] Brand-branch pull — ${brands.length} brands across NCR…`);
    for (const b of brands) {
      try {
        const places = await brandBranchesInBbox(b, REGION_BBOX, { max: 200 });
        const rows = places.map((p) => toRawPoi(p, args.region, 'competitor'));
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
