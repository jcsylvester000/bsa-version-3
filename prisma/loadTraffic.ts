/**
 * R-07 — load a traffic-corridor seasonality file (JSON) into `traffic_corridor` (idempotent,
 * upsert on corridor). Powers the Daypart & Seasonality read for a corridor: the site's corridor
 * (from inferCorridor) is looked up here for its seasonal multipliers.
 *
 *   npm run db:load-traffic -- --file=prisma/data/traffic/cavite.json
 *   npm run db:load-traffic -- --region=batangas --file=prisma/data/traffic/batangas.json
 *
 * The file is a JSON array of corridor rows (same shape as prisma/data/trafficSeasonality.real.json):
 * corridor, baseBand, aadtRef (from DPWH ATTAS — leave null until you have a count), seasonal{...},
 * truthLayer, notes, source. The seasonal multipliers are a documented MODEL (Projected); the base
 * AADT is the empirical part. --region is used only for logging/validation (corridor names are
 * globally unique). Templates + sourcing: prisma/data/traffic/README.md.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/db/prisma';
import { REGION_KEYS, getRegion, type RegionKey } from '@/lib/geo/regions';
import { trafficRowFrom } from '@/lib/geo/trafficRow';

interface Args { region: RegionKey | null; file?: string; url?: string; }

function parseArgs(argv: string[]): Args {
  let region: RegionKey | null = null;
  let file: string | undefined;
  let url: string | undefined;
  for (const a of argv) {
    if (a.startsWith('--region=')) { const r = a.slice(9); if ((REGION_KEYS as string[]).includes(r)) region = r as RegionKey; }
    else if (a.startsWith('--file=')) file = a.slice(7);
    else if (a.startsWith('--url=')) url = a.slice(6);
  }
  if (!file && !url) { console.error('Usage: [--region=<key>] (--file=<json> | --url=<json>)'); process.exit(1); }
  return { region, file, url };
}

async function readSource(args: Args): Promise<string> {
  if (args.url) {
    const res = await fetch(args.url, { headers: { 'User-Agent': 'BSA-traffic' } });
    if (!res.ok) { console.error(`Download failed (${res.status}): ${args.url}`); process.exit(1); }
    return res.text();
  }
  try { return readFileSync(args.file!, 'utf8'); }
  catch { console.error(`File not found: ${args.file}. See prisma/data/traffic/README.md.`); process.exit(1); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let parsed: unknown;
  try { parsed = JSON.parse(await readSource(args)); }
  catch (e) { console.error(`Invalid JSON: ${(e as Error).message}`); process.exit(1); }
  if (!Array.isArray(parsed)) { console.error('Expected a JSON array of corridor rows.'); process.exit(1); }

  // Optional sanity check: warn if a corridor isn't one the region knows (typo guard).
  const known = args.region ? new Set(getRegion(args.region)?.corridors.map((c) => c.name)) : null;

  let loaded = 0, skipped = 0;
  for (const rec of parsed) {
    const row = trafficRowFrom(rec as Record<string, unknown>);
    if (!row) { skipped++; continue; }
    if (known && known.size && !known.has(row.corridor)) {
      console.warn(`  note: "${row.corridor}" is not a known ${args.region} corridor (loading anyway).`);
    }
    await prisma.trafficCorridor.upsert({
      where: { corridor: row.corridor },
      update: { baseBand: row.baseBand, aadtRef: row.aadtRef, seasonal: row.seasonal as object, truthLayer: row.truthLayer, notes: row.notes, source: row.source },
      create: { corridor: row.corridor, baseBand: row.baseBand, aadtRef: row.aadtRef, seasonal: row.seasonal as object, truthLayer: row.truthLayer, notes: row.notes, source: row.source },
    });
    loaded++;
  }
  const total = await prisma.trafficCorridor.count();
  console.log(`✓ traffic_corridor: ${loaded} upserted, ${skipped} skipped, ${total} rows total.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
