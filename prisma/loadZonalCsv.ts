/**
 * R-05 — load BIR zonal values from a CSV into `zonal_value` (idempotent), region-aware.
 *
 *   npm run db:load-zonal -- --region=cavite   --file=prisma/data/zonal/cavite.csv
 *   npm run db:load-zonal -- --region=batangas --url=https://…/batangas_zonal.csv
 *
 * BIR zonal schedules are per-RDO documents (Cavite RDO 54A/54B, Batangas 58/59); an analyst
 * flattens them to a CSV with LGU, barangay (optional), classification (CR/CC/…), and the value
 * (a single zonal value, or low/high). The loader canonicalises the LGU, stamps the region, and
 * upserts via loadZonal. Zonal is a TAX-REFERENCE FLOOR only — never a market price. Idempotent.
 * See prisma/data/zonal/README.md.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/db/prisma';
import { REGION_KEYS, type RegionKey } from '@/lib/geo/regions';
import { parseCsv } from '@/lib/util/csv';
import { zonalRowFrom } from '@/lib/geo/zonalRow';
import { loadZonal } from '@/lib/ingest/loaders';

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
    const res = await fetch(args.url, { headers: { 'User-Agent': 'BSA-zonal' } });
    if (!res.ok) { console.error(`Download failed (${res.status}): ${args.url}`); process.exit(1); }
    return res.text();
  }
  try { return readFileSync(args.file!, 'utf8'); }
  catch { console.error(`File not found: ${args.file}. See prisma/data/zonal/README.md.`); process.exit(1); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = parseCsv(await readSource(args));
  console.log(`Zonal — region=${args.region} rows=${records.length}`);

  const rows = [];
  let skipped = 0;
  for (const rec of records) {
    const row = zonalRowFrom(rec, args.region);
    if (row) rows.push(row); else skipped++;
  }
  const rep = await loadZonal(rows);
  console.log(`Loaded ${rep.loaded} zonal rows (${rep.deduped} dedup, ${rep.skipped + skipped} skipped).`);
  if (rep.loaded === 0) {
    const keys = records[0] ? Object.keys(records[0]).join(', ') : '(none)';
    console.log(`Nothing loaded. Columns seen: ${keys}. The loader needs an LGU + classification (CR/CC) + a value column — extend KEYS in lib/geo/zonalRow.ts if your headers differ.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
