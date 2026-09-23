/**
 * R-07 — load a mall roster from a CSV into `mall_property` (idempotent, upsert on name), for a
 * region. Malls feed the Mall Match module (nearest mall by geom → tier/footfall vs the target).
 *
 *   npm run db:load-malls -- --region=cavite   --file=prisma/data/malls/cavite.csv
 *   npm run db:load-malls -- --region=batangas --url=https://…/batangas_malls.csv
 *
 * CSV columns: mall_name, city, tier (A/B/C), footfall_band (very_high/high/medium/low), lat, lon,
 * rent_band_php_sqm (opt), cusa_band (opt), truth_layer (opt). The loader stamps the region and
 * builds geom from lat/lon. A row with no tier or footfall band is skipped — those are never
 * fabricated. See prisma/data/malls/README.md.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/db/prisma';
import { REGION_KEYS, type RegionKey } from '@/lib/geo/regions';
import { parseCsv } from '@/lib/util/csv';
import { mallRowFrom } from '@/lib/geo/mallRow';
import { loadMalls } from '@/lib/ingest/loaders';

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
    const res = await fetch(args.url, { headers: { 'User-Agent': 'BSA-malls' } });
    if (!res.ok) { console.error(`Download failed (${res.status}): ${args.url}`); process.exit(1); }
    return res.text();
  }
  try { return readFileSync(args.file!, 'utf8'); }
  catch { console.error(`File not found: ${args.file}. See prisma/data/malls/README.md.`); process.exit(1); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = parseCsv(await readSource(args));
  console.log(`Malls — region=${args.region} rows=${records.length}`);

  const rows = [];
  let skipped = 0;
  for (const rec of records) {
    const row = mallRowFrom(rec, args.region);
    if (row) rows.push(row); else skipped++;
  }
  const rep = await loadMalls(rows);
  console.log(`Loaded ${rep.loaded} malls (${rep.deduped} dedup, ${rep.skipped + skipped} skipped — a skip means no valid tier/footfall).`);
  if (rep.loaded === 0) {
    const keys = records[0] ? Object.keys(records[0]).join(', ') : '(none)';
    console.log(`Nothing loaded. Columns seen: ${keys}. Each mall needs a name + tier (A/B/C) + footfall_band. Extend the aliases in lib/geo/mallRow.ts if your headers differ.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
