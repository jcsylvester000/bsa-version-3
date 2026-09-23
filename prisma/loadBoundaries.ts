/**
 * R-02 — load official PSA administrative boundaries into `admin_boundary`.
 *
 *   npm run db:load-boundaries -- --region=cavite --level=barangay --file=prisma/data/boundaries/cavite_barangays.geojson
 *
 * Input is GeoJSON (a FeatureCollection) converted from the PSGC shapefiles — see
 * prisma/data/boundaries/README.md for the ogr2ogr command and where to get the files.
 * One file = one level (region|province|city|barangay). Idempotent: upserts on psgc_code.
 * Geometry is stored as geography(MultiPolygon,4326) via ST_GeomFromGeoJSON.
 *
 * Row-by-row upsert (boundaries are a one-time load; A-03 batches loaders later). Prints any
 * features it could not map so the property-key lists in lib/geo/boundaryFeature.ts can be extended.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/db/prisma';
import { REGION_KEYS, type RegionKey } from '@/lib/geo/regions';
import { type BoundaryLevel } from '@/lib/geo/boundaryFeature';
import { upsertBoundaryFeature } from '@/lib/geo/boundaryUpsert';

interface Args { region: RegionKey; level: BoundaryLevel; file: string; }

function parseArgs(argv: string[]): Args {
  let region: RegionKey | null = null;
  let level: BoundaryLevel | null = null;
  let file: string | null = null;
  for (const a of argv) {
    if (a.startsWith('--region=')) { const r = a.slice(9); if ((REGION_KEYS as string[]).includes(r)) region = r as RegionKey; }
    else if (a.startsWith('--level=')) { const l = a.slice(8); if (['region', 'province', 'city', 'barangay'].includes(l)) level = l as BoundaryLevel; }
    else if (a.startsWith('--file=')) file = a.slice(7);
  }
  if (!region || !level || !file) {
    console.error('Usage: --region=<ncr|davao|cavite|batangas> --level=<region|province|city|barangay> --file=<path.geojson>');
    process.exit(1);
  }
  return { region, level, file };
}

interface Feature { type: string; properties?: Record<string, unknown>; geometry?: unknown }
interface FeatureCollection { type: string; features?: Feature[] }

async function main() {
  const { region, level, file } = parseArgs(process.argv.slice(2));
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    console.error(`File not found: ${file}`);
    console.error('You need the GeoJSON first. Easiest: npm run db:fetch-boundaries -- --region=' + region +
      ' (auto-downloads, no GDAL). Otherwise convert the PSGC shapefiles with ogr2ogr — see prisma/data/boundaries/README.md.');
    process.exit(1);
  }
  const fc = JSON.parse(raw) as FeatureCollection;
  const features = Array.isArray(fc.features) ? fc.features : [];
  console.log(`Boundaries — region=${region} level=${level} file=${file} (${features.length} features)`);

  let loaded = 0;
  let skipped = 0;
  const sampleKeys = features[0]?.properties ? Object.keys(features[0].properties) : [];

  for (const f of features) {
    const ok = await upsertBoundaryFeature(f, level, region);
    if (ok) loaded++; else skipped++;
  }

  console.log(`Loaded ${loaded} boundaries (${skipped} skipped).`);
  if (skipped > 0) {
    console.log(`Skipped features had no recognised PSGC code / name. Properties seen on feature[0]: ${sampleKeys.join(', ')}`);
    console.log('If those are the code/name fields, add them to KEYS in lib/geo/boundaryFeature.ts and re-run.');
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
