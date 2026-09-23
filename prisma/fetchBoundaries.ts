/**
 * R-02 — download + load official PSA administrative boundaries into `admin_boundary`,
 * with NO GDAL and NO shapefile clone.
 *
 *   npm run db:fetch-boundaries -- --region=cavite
 *   npm run db:fetch-boundaries -- --region=batangas
 *
 * Pulls ready-made GeoJSON from faeldon/philippines-json-maps (MIT; PSGC Q4-2023, sourced from
 * the same PSA shapefiles) at medium resolution, for the province → its cities → their barangays,
 * and loads each into admin_boundary (Verified). Idempotent (upsert on psgc_code). Run
 * `npm run db:tag-boundaries` afterwards to backfill existing POIs/sites.
 *
 * Data © OpenStreetMap/PSA via philippines-json-maps (MIT). Requires network + Node 18+ (global fetch).
 */
import 'dotenv/config';
import { prisma } from '@/lib/db/prisma';
import { getRegion, REGION_KEYS, type RegionKey } from '@/lib/geo/regions';
import { upsertBoundaryFeature, type BoundaryFeature } from '@/lib/geo/boundaryUpsert';

const BASE = 'https://raw.githubusercontent.com/faeldon/philippines-json-maps/master/2023/geojson';
const RES = '0.01'; // medium resolution

interface FeatureCollection { features?: BoundaryFeature[] }

function parseRegion(argv: string[]): RegionKey {
  const a = argv.find((x) => x.startsWith('--region='));
  const r = a?.slice('--region='.length);
  if (!r || !(REGION_KEYS as string[]).includes(r)) {
    console.error(`Usage: --region=<${REGION_KEYS.join('|')}>`);
    process.exit(1);
  }
  return r as RegionKey;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string): Promise<FeatureCollection | null> {
  const res = await fetch(url, { headers: { 'User-Agent': 'BSA-boundary-fetch' } });
  if (!res.ok) { console.warn(`   ! ${res.status} ${url.split('/').pop()}`); return null; }
  return (await res.json()) as FeatureCollection;
}

/** adm3_psgc off a municipality feature, as the string the barangay filename uses. */
function cityCode(f: BoundaryFeature): string | null {
  const p = f.properties ?? {};
  const v = p['adm3_psgc'] ?? p['ADM3_PCODE'] ?? p['psgc'];
  const s = v == null ? '' : `${v}`.replace(/[^0-9]/g, '');
  return s || null;
}

async function main() {
  const regionKey = parseRegion(process.argv.slice(2));
  const region = getRegion(regionKey)!;
  if (!region.psgcRegionCode || !region.psgcProvinces?.length) {
    console.error(`No PSGC download mapping for "${regionKey}" yet. Add psgcRegionCode + psgcProvinces to`);
    console.error('lib/geo/regions.ts, or use the ogr2ogr file path (prisma/data/boundaries/README.md).');
    process.exit(1);
  }

  console.log(`Fetching boundaries for ${region.name} (medres) from philippines-json-maps…`);
  let provinces = 0, cities = 0, barangays = 0;

  // 1) Provinces of the region — load only the target province(s), tagged with this region key.
  const regFc = await getJson(`${BASE}/regions/medres/provdists-region-${region.psgcRegionCode}.${RES}.json`);
  for (const f of regFc?.features ?? []) {
    const code = cityCodeLike(f, 'adm2_psgc');
    if (code && region.psgcProvinces.includes(code)) {
      if (await upsertBoundaryFeature(f, 'province', regionKey)) provinces++;
    }
  }

  // 2) Each province → its cities/municipalities, then 3) each city → its barangays.
  for (const provCode of region.psgcProvinces) {
    await sleep(300);
    const muniFc = await getJson(`${BASE}/provdists/medres/municities-provdist-${provCode}.${RES}.json`);
    const cityCodes: string[] = [];
    for (const f of muniFc?.features ?? []) {
      if (await upsertBoundaryFeature(f, 'city', regionKey)) cities++;
      const cc = cityCode(f);
      if (cc) cityCodes.push(cc);
    }
    console.log(`   province ${provCode}: ${cityCodes.length} cities/municipalities`);

    for (const cc of cityCodes) {
      await sleep(300);
      const bgyFc = await getJson(`${BASE}/municities/medres/bgysubmuns-municity-${cc}.${RES}.json`);
      let n = 0;
      for (const f of bgyFc?.features ?? []) {
        if (await upsertBoundaryFeature(f, 'barangay', regionKey)) { barangays++; n++; }
      }
      console.log(`     city ${cc}: ${n} barangays`);
    }
  }

  console.log(`\nDone — ${provinces} province, ${cities} cities, ${barangays} barangays loaded for ${region.name}.`);
  console.log('Now run: npm run db:tag-boundaries   (backfills existing POIs/sites; new sites tag at intake).');
}

/** Generic numeric PSGC off a feature for a named key (used for the province filter). */
function cityCodeLike(f: BoundaryFeature, key: string): string | null {
  const v = (f.properties ?? {})[key];
  const s = v == null ? '' : `${v}`.replace(/[^0-9]/g, '');
  return s || null;
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
