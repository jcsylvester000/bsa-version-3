/**
 * R-04 — load PSA census barangay populations into `demographic_cell`, tied to the R-02
 * barangay polygons (so Site Fit / Daypart / White-Space score provincial sites).
 *
 *   npm run db:load-demographics -- --region=cavite --file=prisma/data/demographics/cavite.csv
 *   npm run db:load-demographics -- --region=cavite --url=https://…/phl_admpop_adm4_2020.csv
 *
 * Input is a CSV keyed by 10-digit PSGC (barangay). Population is Verified (PSA census); income /
 * daytime are Assumed only when the file provides them. `geom` is copied from admin_boundary by
 * PSGC (load boundaries first: db:fetch-boundaries). Rows with no matching boundary load without
 * geom and are reported. Idempotent (upsert on psgc_code). See prisma/data/demographics/README.md.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/db/prisma';
import { REGION_KEYS, type RegionKey } from '@/lib/geo/regions';
import { parseCsv } from '@/lib/util/csv';
import { demographicsRowFrom } from '@/lib/geo/demographicsRow';

interface Args { region: RegionKey; file?: string; url?: string; }

function parseArgs(argv: string[]): Args {
  let region: RegionKey | null = null;
  let file: string | undefined;
  let url: string | undefined;
  for (const a of argv) {
    if (a.startsWith('--region=')) { const r = a.slice(9); if ((REGION_KEYS as string[]).includes(r)) region = r as RegionKey; }
    else if (a.startsWith('--file=')) file = a.slice(7);
    else if (a.startsWith('--url=')) url = a.slice(6);
  }
  if (!region || (!file && !url)) {
    console.error('Usage: --region=<ncr|davao|cavite|batangas> (--file=<csv> | --url=<csv>)');
    process.exit(1);
  }
  return { region, file, url };
}

async function readSource(args: Args): Promise<string> {
  if (args.url) {
    const res = await fetch(args.url, { headers: { 'User-Agent': 'BSA-demographics' } });
    if (!res.ok) { console.error(`Download failed (${res.status}): ${args.url}`); process.exit(1); }
    return res.text();
  }
  try {
    return readFileSync(args.file!, 'utf8');
  } catch {
    console.error(`File not found: ${args.file}. Download the barangay-population CSV first (see prisma/data/demographics/README.md), or pass --url=.`);
    process.exit(1);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = parseCsv(await readSource(args));
  console.log(`Demographics — region=${args.region} rows=${records.length}`);
  if (records.length === 0) { console.error('No rows parsed. Check the CSV.'); process.exit(1); }

  let loaded = 0, noPop = 0, noGeom = 0, skipped = 0;
  for (const rec of records) {
    const row = demographicsRowFrom(rec);
    if (!row) { skipped++; continue; }
    if (row.population == null) noPop++;
    // Population Verified (census); a row with only estimated bands would be Assumed — census rows
    // always carry a real population, so Verified here.
    await prisma.demographicCell.upsert({
      where: { psgcCode: row.psgcCode },
      update: { barangay: row.barangay, city: row.city, population: row.population, incomeBand: row.incomeBand, daytimePop: row.daytimePop, truthLayer: 'verified' },
      create: { psgcCode: row.psgcCode, barangay: row.barangay, city: row.city, population: row.population, incomeBand: row.incomeBand, daytimePop: row.daytimePop, truthLayer: 'verified' },
    });
    // Copy the barangay boundary geometry (if loaded) so catchment ST_DWithin works over the real area.
    const upd = await prisma.$executeRaw`
      UPDATE demographic_cell d
      SET geom = b.geom
      FROM admin_boundary b
      WHERE d.psgc_code = ${row.psgcCode} AND b.psgc_code = ${row.psgcCode} AND b.level = 'barangay' AND b.geom IS NOT NULL`;
    if (upd === 0) noGeom++;
    loaded++;
  }

  console.log(`Loaded ${loaded} barangays (${skipped} no-PSGC skipped).`);
  if (noPop > 0) console.log(`  ${noPop} rows had no population column — check the CSV's population field name (extend KEYS in lib/geo/demographicsRow.ts).`);
  if (noGeom > 0) console.log(`  ${noGeom} rows had no matching boundary geometry — run db:fetch-boundaries for this region first, then re-run this to attach geom.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
