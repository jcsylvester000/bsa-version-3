/**
 * R-06 — load lease comps from a CSV into `lease_comp` (idempotent per format+corridor), for a
 * region's provincial corridors.
 *
 *   npm run db:load-lease -- --region=cavite   --file=prisma/data/lease/cavite.csv
 *   npm run db:load-lease -- --region=batangas --url=https://…/batangas_lease.csv
 *
 * Lease comps are broker-observed or published corridor bands. An analyst flattens them to a CSV
 * with a corridor (or LGU/barangay, which the loader maps to a corridor), a store format, and the
 * terms (base rent ₱/sqm, and optionally escalation, CUSA, term, fit-out). The loader canonicalises
 * the corridor to the region registry (so Bacoor/Molino/Imus → "Bacoor–Imus") and upserts via the
 * existing loadLease, which clears each (format, corridor) group it touches then inserts fresh.
 *
 * Truth Layer: a published band may be `verified`; a single broker point defaults to `assumed`.
 * No rate is ever invented — a row with no numeric term is dropped. See prisma/data/lease/README.md.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/db/prisma';
import { REGION_KEYS, getRegion, type RegionKey } from '@/lib/geo/regions';
import { parseCsv } from '@/lib/util/csv';
import { leaseRowFrom } from '@/lib/geo/leaseRow';
import { loadLease } from '@/lib/ingest/loaders';

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
    const res = await fetch(args.url, { headers: { 'User-Agent': 'BSA-lease' } });
    if (!res.ok) { console.error(`Download failed (${res.status}): ${args.url}`); process.exit(1); }
    return res.text();
  }
  try { return readFileSync(args.file!, 'utf8'); }
  catch { console.error(`File not found: ${args.file}. See prisma/data/lease/README.md.`); process.exit(1); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const records = parseCsv(await readSource(args));
  const corridors = getRegion(args.region)?.corridors.map((c) => c.name).join(', ') || '(none)';
  console.log(`Lease — region=${args.region} rows=${records.length}. Known corridors: ${corridors}`);

  const rows = [];
  let skipped = 0;
  for (const rec of records) {
    const row = leaseRowFrom(rec, args.region);
    if (row) rows.push(row); else skipped++;
  }
  const rep = await loadLease(rows);
  console.log(`Loaded ${rep.loaded} lease comps (${rep.deduped} dedup, ${rep.skipped + skipped} skipped).`);
  if (rep.loaded === 0) {
    const keys = records[0] ? Object.keys(records[0]).join(', ') : '(none)';
    console.log(`Nothing loaded. Columns seen: ${keys}. The loader needs a corridor (or LGU) + at least one term (base_rent_php_sqm). Extend the aliases in lib/geo/leaseRow.ts if your headers differ.`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
