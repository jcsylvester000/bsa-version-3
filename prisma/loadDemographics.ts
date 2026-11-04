/**
 * R-04 — load PSA census barangay populations into `demographic_cell`, tied to the R-02
 * barangay polygons (so Site Fit / Daypart / White-Space score the site).
 *
 *   npm run db:load-demographics -- --region=ncr --year=2020 --file=prisma/data/demographics/ncr.csv
 *   npm run db:load-demographics -- --region=cavite --url=https://…/phl_admpop_adm4_2020.csv
 *   … add --retire-legacy to replace the old sample cells in the same cities (see below)
 *
 * Input is a CSV keyed by PSGC (barangay); a nationwide file is fine — only barangays whose boundary is
 * loaded for --region are taken. Per-field Truth Layer (Brief T-1): census POPULATION is
 * Verified; income / daytime bands from the file are Assumed. The census year (Brief T-4) comes from
 * --year, else the population column name (pop_2020 / pop_2024). `geom` is copied from admin_boundary
 * by PSGC (load boundaries first: db:fetch-boundaries). Idempotent (upsert on psgc_code). A re-load never
 * blanks bands the file doesn't carry. See prisma/data/demographics/README.md.
 *
 * --retire-legacy: the 296 early sample cells (no per-field label; mostly made-up codes, 600 m circles); left in place they
 * would double-count people next to the real barangays. With this flag, for every city that now has
 * census barangays, each legacy cell hands its estimated bands (income, daytime, age, renter share) to
 * the real barangay of the same name, then is deleted. Without the flag the loader only REPORTS what it
 * would retire (dry run). The 26 Oct 2026 database image is the backup.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { prisma } from '@/lib/db/prisma';
import { REGION_KEYS, getRegion, type RegionKey } from '@/lib/geo/regions';
import { parseCsv } from '@/lib/util/csv';
import { demographicsRowFrom } from '@/lib/geo/demographicsRow';
import { censusSourceLabel } from '@/lib/geo/censusMeta';

interface Args { region: RegionKey; file?: string; url?: string; year?: number; retireLegacy: boolean }

function parseArgs(argv: string[]): Args {
  let region: RegionKey | null = null;
  let file: string | undefined;
  let url: string | undefined;
  let year: number | undefined;
  let retireLegacy = false;
  for (const a of argv) {
    if (a.startsWith('--region=')) { const r = a.slice(9); if ((REGION_KEYS as string[]).includes(r)) region = r as RegionKey; }
    else if (a.startsWith('--file=')) file = a.slice(7);
    else if (a.startsWith('--url=')) url = a.slice(6);
    else if (a.startsWith('--year=')) { const y = Number(a.slice(7)); if (y >= 2000 && y <= 2100) year = y; }
    else if (a === '--retire-legacy') retireLegacy = true;
  }
  if (!region || (!file && !url)) {
    console.error(`Usage: --region=<${REGION_KEYS.join('|')}> (--file=<csv> | --url=<csv>) [--year=2020|2024] [--retire-legacy]`);
    process.exit(1);
  }
  return { region, file, url, year, retireLegacy };
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

  const region = getRegion(args.region)?.psaRegion ?? null; // stamp the PSA region for scoped reads (F-12)
  // Only barangays whose boundary is loaded for THIS region (so a nationwide census file can be used
  // as-is and nothing outside the region is stamped with its name). Load boundaries first.
  const inRegion = new Set((await prisma.adminBoundary.findMany({
    where: { region: args.region, level: 'barangay' }, select: { psgcCode: true },
  })).map((b) => b.psgcCode));
  if (inRegion.size === 0) {
    console.error(`No barangay boundaries loaded for ${args.region}. Run: npm run db:fetch-boundaries -- --region=${args.region}`);
    process.exit(1);
  }
  let loaded = 0, noPop = 0, noGeom = 0, skipped = 0, outside = 0;
  const cities = new Set<string>();
  for (const rec of records) {
    const row = demographicsRowFrom(rec);
    if (!row) { skipped++; continue; }
    if (!inRegion.has(row.psgcCode)) { outside++; continue; }
    if (row.population == null) noPop++;
    const censusYear = args.year ?? row.censusYear ?? null;
    const populationSource = censusSourceLabel(censusYear);
    const hasBands = row.incomeBand != null || row.daytimePop != null;
    // Per-field truth: census population Verified; bands from the file Assumed. A row without a
    // population keeps the weakest label so it never reads as a census figure.
    const populationTruth = row.population != null ? 'verified' as const : 'assumed' as const;
    const base = {
      barangay: row.barangay, city: row.city, population: row.population, region,
      populationTruth, censusYear, populationSource,
      truthLayer: populationTruth,
    };
    const bands = hasBands
      ? { incomeBand: row.incomeBand ?? undefined, daytimePop: row.daytimePop ?? undefined, bandsTruth: 'assumed' as const }
      : {};
    await prisma.demographicCell.upsert({
      where: { psgcCode: row.psgcCode },
      update: { ...base, ...bands },                    // never blank bands the file doesn't carry
      create: { psgcCode: row.psgcCode, ...base, ...bands },
    });
    // Copy the barangay boundary geometry (if loaded) so catchment ST_DWithin works over the real area.
    const upd = await prisma.$executeRaw`
      UPDATE demographic_cell d
      SET geom = b.geom
      FROM admin_boundary b
      WHERE d.psgc_code = ${row.psgcCode} AND b.psgc_code = ${row.psgcCode} AND b.level = 'barangay' AND b.geom IS NOT NULL`;
    if (upd === 0) noGeom++;
    if (row.city) cities.add(row.city);
    loaded++;
  }

  console.log(`Loaded ${loaded} of ${inRegion.size} ${args.region} barangays (${outside} rows outside the region, ${skipped} without a PSGC code, skipped).`);
  if (loaded < inRegion.size) console.log(`  ${inRegion.size - loaded} ${args.region} barangays had no row in the file — they stay unscored (honest gap).`);
  if (noPop > 0) console.log(`  ${noPop} rows had no population column — check the CSV's population field name (extend KEYS in lib/geo/demographicsRow.ts).`);
  if (noGeom > 0) console.log(`  ${noGeom} rows had no matching boundary geometry — run db:fetch-boundaries for this region first, then re-run this to attach geom.`);

  await retireLegacyCells(args.retireLegacy);
}

/**
 * Legacy sample cells (made-up codes, 600 m circles) that sit in a city which now has census
 * barangays WITH geometry. Each hands its estimated bands to the real barangay of the same name
 * (only where the real one has none), then is deleted. Dry run unless `apply`.
 */
async function retireLegacyCells(apply: boolean) {
  const legacy = await prisma.demographicCell.findMany({
    where: { populationTruth: null },
    select: { id: true, psgcCode: true, barangay: true, city: true },
  });
  // Legacy = never loaded from a census file (no per-field label), whatever its code looks like.
  const candidates = legacy.filter((c) => c.city);
  if (!candidates.length) return;
  const realCities = await prisma.$queryRaw<Array<{ city: string }>>`
    SELECT DISTINCT city FROM demographic_cell WHERE population_truth = 'verified' AND geom IS NOT NULL AND city IS NOT NULL`;
  const norm = (s: string) => s.toLowerCase().replace(/^city of\s+/, '').replace(/\s+city$/, '').replace(/[^a-z0-9ñ]+/g, ' ').trim();
  const covered = new Set(realCities.map((r) => norm(r.city)));
  const toRetire = candidates.filter((c) => covered.has(norm(c.city!)));
  if (!toRetire.length) { console.log('Legacy sample cells: none in cities with census barangays yet.'); return; }
  console.log(`Legacy sample cells in census-covered cities: ${toRetire.length}${apply ? '' : ' (dry run — add --retire-legacy to replace them)'}.`);
  if (!apply) return;
  let carried = 0, removed = 0;
  for (const c of toRetire) {
    // Hand the estimated bands to the real barangay with the same name in the same city (bands only).
    carried += await prisma.$executeRaw`
      UPDATE demographic_cell r SET
        income_band = COALESCE(r.income_band, l.income_band),
        daytime_pop = COALESCE(r.daytime_pop, l.daytime_pop),
        age_profile = COALESCE(r.age_profile, l.age_profile),
        renter_share_pct = COALESCE(r.renter_share_pct, l.renter_share_pct),
        bands_truth = COALESCE(r.bands_truth, CASE WHEN l.income_band IS NOT NULL OR l.daytime_pop IS NOT NULL THEN 'assumed'::"TruthLayer" END)
      FROM demographic_cell l
      WHERE l.id = ${c.id} AND r.population_truth = 'verified'
        AND lower(r.barangay) = lower(l.barangay)
        AND regexp_replace(lower(r.city), '^city of\\s+|\\s+city$', '', 'g') = regexp_replace(lower(l.city), '^city of\\s+|\\s+city$', '', 'g')`;
    removed += await prisma.$executeRaw`DELETE FROM demographic_cell WHERE id = ${c.id}`;
  }
  console.log(`Retired ${removed} legacy cells; ${carried} real barangays received estimated bands.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
