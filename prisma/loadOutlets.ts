/**
 * Brief alignment T-5 — load a BRAND-SUPPLIED branch list (the brand's own outlet list) for one brand.
 *
 *   npm run db:load-outlets -- --brand="Macao Imperial Tea" --file=prisma/data/outlets/macao.csv
 *   npm run db:load-outlets -- --brand=<franchisor uuid> --file=… --sales-consent
 *
 * CSV columns: outlet_name, lat, lon [, format, status, monthly_sales_php]. Locations from the brand's
 * own list are Verified (an official source — the brief's meaning of Verified, not a ground check).
 * Monthly sales are loaded ONLY with --sales-consent (the brand agreed to share them) and stay Assumed
 * (self-reported). Without the flag, any sales column is ignored.
 *
 * Idempotent: replaces this brand's previous brand_list outlets. Outlets typed into intakes and the
 * legacy reference network are left alone. Planned branches are skipped (not open yet).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { parseCsv } from '@/lib/util/csv';
import { outletRowFrom } from '@/lib/geo/outletRow';

interface Args { brand: string; file: string; salesConsent: boolean }

function parseArgs(argv: string[]): Args {
  let brand = '', file = '';
  let salesConsent = false;
  for (const a of argv) {
    if (a.startsWith('--brand=')) brand = a.slice(8).replace(/^"|"$/g, '');
    else if (a.startsWith('--file=')) file = a.slice(7);
    else if (a === '--sales-consent') salesConsent = true;
  }
  if (!brand || !file) {
    console.error('Usage: --brand=<brand name | franchisor id> --file=<csv> [--sales-consent]');
    process.exit(1);
  }
  return { brand, file, salesConsent };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const brands = await prisma.franchisor.findMany({
    where: UUID.test(args.brand) ? { id: args.brand } : { brandName: { equals: args.brand, mode: 'insensitive' } },
    select: { id: true, brandName: true, createdByUserId: true },
  });
  // Prefer the shared catalogue brand when a private copy has the same name.
  const brand = brands.find((b) => b.createdByUserId == null) ?? brands[0];
  if (!brand) { console.error(`Brand not found: ${args.brand}`); process.exit(1); }

  let text: string;
  try { text = readFileSync(args.file, 'utf8'); } catch { console.error(`File not found: ${args.file}`); process.exit(1); }
  const records = parseCsv(text);
  const rows = [];
  const skipped: string[] = [];
  for (const rec of records) {
    const r = outletRowFrom(rec);
    if ('skip' in r) skipped.push(r.skip); else rows.push(r.row);
  }
  console.log(`${brand.brandName}: ${rows.length} outlets to load, ${skipped.length} skipped.`);
  for (const s of skipped.slice(0, 20)) console.log(`  skipped — ${s}`);
  if (!rows.length) process.exit(1);

  // Replace only this brand's previous brand-supplied list (single statement — no transaction).
  const removed = await prisma.$executeRaw`DELETE FROM outlet WHERE franchisor_id = ${brand.id}::uuid AND source = 'brand_list'`;
  let loaded = 0;
  for (const r of rows) {
    const sales = args.salesConsent ? r.monthlySalesPhp : null;
    await prisma.outlet.create({
      data: {
        franchisorId: brand.id,
        outletName: r.outletName,
        format: r.format,
        status: r.status,
        lat: r.lat,
        lon: r.lon,
        monthlySalesPhp: sales != null ? new Prisma.Decimal(sales) : null,
        source: 'brand_list',
        locationTruth: 'verified',
        salesTruth: sales != null ? 'assumed' : null,
        // Row label = the weakest field actually stored.
        truthLayer: sales != null ? 'assumed' : 'verified',
      },
    });
    loaded++;
  }
  // Point geography for the overlap math (the outlet table has no DB trigger for it on every setup).
  await prisma.$executeRaw`
    UPDATE outlet SET geom = ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography
    WHERE franchisor_id = ${brand.id}::uuid AND source = 'brand_list' AND geom IS NULL`;
  console.log(`Loaded ${loaded} brand-list outlets (replaced ${removed}). Locations Verified; sales ${args.salesConsent ? 'loaded (Assumed, with consent)' : 'not loaded (no --sales-consent)'}.`);
  console.log('Re-run affected analyses so Territory Guard uses the new list.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
