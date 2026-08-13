/**
 * db:populate — the real-data orchestrator.
 *
 *   npm run db:populate                    # full NCR + Davao real-data build
 *   npm run db:populate -- --region=ncr    # NCR only
 *   npm run db:populate -- --region=davao  # Davao (Region XI) POI/mall/health sweep only
 *   npm run db:populate -- --brands jollibee,mercury-drug
 *   npm run db:populate -- --skip-places   # curated files + docs only (no Google calls)
 *   npm run db:populate -- --quick         # fewer cities / smaller grid (fast dev run)
 *
 * Convenience scripts: `npm run db:populate:davao` (region=davao),
 * `npm run db:populate:ncr` (region=ncr).
 *
 * Pulls REAL Philippine establishments via Google Places (franchisors + outlets,
 * competitor/anchor POIs, malls, healthcare), loads curated real BIR-zonal /
 * PSA-demographics / lease-comp files, and chunks the methodology corpus for AI
 * retrieval. Idempotent end to end — re-runs upsert, never duplicate. Prints a
 * per-table row count and a Truth Layer breakdown at the end.
 *
 * Truth Layer discipline: real coordinates = Verified; non-public figures (chain
 * sales, mall footfall, some zonal/lease estimates) = Assumed and labelled as such.
 * No invented number is ever written as Verified.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  BRAND_CATALOG, NCR_GRID, NCR_CITIES,
  DAVAO_GRID, DAVAO_MALL_QUERIES,
  pullBrand, pullPoiSweep, pullMalls, pullHealthcare,
  type BrandDef, type PullReport,
} from '../lib/ingest/places';
import { loadZonal, loadDemographics, loadLease } from '../lib/ingest/loaders';
import { hasPlacesKey } from '../lib/places/placesService';

const DATA = path.join(process.cwd(), 'prisma', 'data');
const read = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));

type Region = 'ncr' | 'davao' | 'all';
interface Args { brands?: string[]; skipPlaces: boolean; quick: boolean; region: Region; }
function parseArgs(argv: string[]): Args {
  const a: Args = { skipPlaces: false, quick: false, region: 'all' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--brands') a.brands = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--skip-places') a.skipPlaces = true;
    else if (argv[i] === '--quick') a.quick = true;
    else if (argv[i] === '--region') {
      const r = (argv[++i] ?? '').toLowerCase();
      if (r === 'ncr' || r === 'davao' || r === 'all') a.region = r;
    } else if (argv[i].startsWith('--region=')) {
      const r = argv[i].split('=')[1]?.toLowerCase();
      if (r === 'ncr' || r === 'davao' || r === 'all') a.region = r;
    }
  }
  return a;
}

function fmt(r: PullReport): string {
  return `loaded ${r.loaded} (received ${r.received}, deduped ${r.deduped}, skipped ${r.skipped})`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cities = args.quick ? NCR_CITIES.slice(0, 4) : NCR_CITIES;
  const grid = args.quick ? NCR_GRID.slice(0, 4) : NCR_GRID;

  // db:populate is the ONE deliberate paid step — it opts into live Google Places for
  // this process only (the app runtime keeps live calls OFF unless PLACES_LIVE is set).
  // Skip this opt-in with --skip-places to load curated data with zero Google cost.
  if (!args.skipPlaces && process.env.GOOGLE_API_KEY) {
    process.env.PLACES_LIVE = '1';
    console.log('⚠  LIVE Google Places is ON for this ingest (this makes paid API calls).');
    console.log('   Use --skip-places to load curated demographics/lease/zonal with no API cost.\n');
  }

  const doNcr = args.region === 'ncr' || args.region === 'all';
  const doDavao = args.region === 'davao' || args.region === 'all';
  console.log(`BSA real-data populate — region: ${args.region.toUpperCase()}`);
  console.log('='.repeat(60));

  // --- 1. Real franchisors + outlets (Google Places) ----------------------
  if (!args.skipPlaces && hasPlacesKey()) {
    if (doNcr) {
      const brands: BrandDef[] = args.brands
        ? BRAND_CATALOG.filter((b) => args.brands!.includes(b.slug))
        : BRAND_CATALOG;
      console.log(`\n[1/6] NCR franchisors + real outlets (${brands.length} brands across ${cities.length} cities)…`);
      for (const b of brands) {
        const r = await pullBrand(b, { cities, perCity: args.quick ? 5 : 8 });
        console.log(`  ${b.brandName.padEnd(20)} ${fmt(r)}`);
      }

      // --- 2. NCR competitor / anchor POI sweep --------------------------
      console.log(`\n[2/6] NCR competitor + anchor POI sweep (${grid.length} grid cells)…`);
      const poi = await pullPoiSweep({ grid, perCell: args.quick ? 12 : 20 });
      console.log(`  POI ${fmt(poi)}`);

      // --- 3. NCR malls --------------------------------------------------
      console.log('\n[3/6] NCR malls (SM / Ayala / Robinsons / Megaworld)…');
      const malls = await pullMalls({ perQuery: args.quick ? 12 : 20 });
      console.log(`  malls ${fmt(malls)}`);

      // --- 4. NCR healthcare ---------------------------------------------
      console.log(`\n[4/6] NCR healthcare facilities (${grid.length} grid cells)…`);
      const health = await pullHealthcare({ grid, perCell: args.quick ? 12 : 20 });
      console.log(`  healthcare ${fmt(health)}`);
    }

    // --- Region XI (Davao) POI / mall / healthcare sweep -----------------
    // Same Places pipeline pointed at the Davao grid + Davao-qualified mall queries.
    // Brands/outlets stay NCR-catalogued today; the POI/mall/health layer is what the
    // Davao candidates need, so we sweep those here (idempotent — re-runs upsert).
    if (doDavao) {
      const dGrid = args.quick ? DAVAO_GRID.slice(0, 6) : DAVAO_GRID;
      console.log(`\n[Davao] Competitor + anchor POI sweep (${dGrid.length} grid cells)…`);
      const dpoi = await pullPoiSweep({ grid: dGrid, perCell: args.quick ? 12 : 20 });
      console.log(`  POI ${fmt(dpoi)}`);

      console.log('\n[Davao] Malls (SM Lanang / Abreeza / Gaisano / NCCC / provincial)…');
      const dmalls = await pullMalls({ queries: DAVAO_MALL_QUERIES, perQuery: args.quick ? 12 : 20, regionSuffix: '' });
      console.log(`  malls ${fmt(dmalls)}`);

      console.log(`\n[Davao] Healthcare facilities (${dGrid.length} grid cells)…`);
      const dhealth = await pullHealthcare({ grid: dGrid, perCell: args.quick ? 12 : 20 });
      console.log(`  healthcare ${fmt(dhealth)}`);
    }
  } else {
    console.log('\n[1–4/6] Skipping Google Places pulls (no key or --skip-places).');
  }

  // --- 5. Curated real reference files ------------------------------------
  console.log('\n[5/6] Curated real reference data (BIR zonal / PSA demographics / lease comps)…');
  console.log(`  zonal        ${JSON.stringify(await loadZonal(read('zonal.real.json')))}`);
  console.log(`  demographics ${JSON.stringify(await loadDemographics(read('demographics.real.json')))}`);
  console.log(`  lease        ${JSON.stringify(await loadLease(read('lease.real.json')))}`);

  // --- 6. Methodology doc chunks (AI substrate) ---------------------------
  console.log('\n[6/6] Methodology doc chunks (AI retrieve substrate)…');
  const { seedMethodologyChunks } = await import('./methodologyChunks');
  const chunkCount = await seedMethodologyChunks();
  console.log(`  doc_chunk    seeded ${chunkCount} methodology chunks`);

  // --- Summary ------------------------------------------------------------
  await printSummary();
}

async function printSummary() {
  const { prisma } = await import('@/lib/db/prisma');
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY — row counts');
  console.log('='.repeat(60));

  const counts: Array<[string, number]> = [
    ['franchisor', await prisma.franchisor.count()],
    ['outlet', await prisma.outlet.count()],
    ['poi', await prisma.poi.count()],
    ['mall_property', await prisma.mallProperty.count()],
    ['zonal_value', await prisma.zonalValue.count()],
    ['demographic_cell', await prisma.demographicCell.count()],
    ['lease_comp', await prisma.leaseComp.count()],
    ['doc_chunk', await prisma.docChunk.count()],
  ];
  for (const [t, n] of counts) console.log(`  ${t.padEnd(18)} ${n}`);

  // Truth Layer breakdown across the reference tables (one grouped query per table).
  console.log('\nTruth Layer breakdown');
  const layers = ['verified', 'assumed', 'projected'] as const;
  const tl = async (
    label: string,
    counter: (where: { truthLayer: 'verified' | 'assumed' | 'projected' }) => Promise<number>,
  ) => {
    const nums = await Promise.all(layers.map((l) => counter({ truthLayer: l })));
    console.log(`  ${label.padEnd(18)} verified=${nums[0]} assumed=${nums[1]} projected=${nums[2]}`);
  };
  await tl('outlet', (w) => prisma.outlet.count({ where: w }));
  await tl('poi', (w) => prisma.poi.count({ where: w }));
  await tl('mall_property', (w) => prisma.mallProperty.count({ where: w }));
  await tl('zonal_value', (w) => prisma.zonalValue.count({ where: w }));
  await tl('demographic_cell', (w) => prisma.demographicCell.count({ where: w }));
  await tl('lease_comp', (w) => prisma.leaseComp.count({ where: w }));

  console.log('\nPopulate complete.');
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
