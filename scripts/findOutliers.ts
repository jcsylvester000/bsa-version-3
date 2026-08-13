/**
 * One-off: find (and optionally fix) outlet rows whose coordinates fall outside Metro
 * Manila bounds — the known "mis-geocoded outlet near Baguio" data-quality item.
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/findOutliers.ts          # LIST outliers
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/findOutliers.ts --delete # DELETE them
 *
 * Lists first so you can see exactly what's flagged before removing anything.
 */
import 'dotenv/config';

// Metro Manila bounds. Anything outside is out-of-region for an NCR outlet network.
const NCR = { latMin: 14.25, latMax: 14.85, lonMin: 120.85, lonMax: 121.2 };

async function main() {
  // Dynamic import (matches ingest.ts / ingestOsm.ts) so the server-only shim resolves
  // when this runs under tsx.
  const { prisma } = await import('@/lib/db/prisma');
  const doDelete = process.argv.includes('--delete');

  const rows = await prisma.$queryRaw<Array<{ id: string; outlet_name: string; lat: number; lon: number; brand: string | null }>>`
    SELECT o.id, o.outlet_name, o.lat, o.lon, f.brand_name AS brand
    FROM outlet o
    LEFT JOIN franchisor f ON f.id = o.franchisor_id
    WHERE o.lat > ${NCR.latMax} OR o.lat < ${NCR.latMin}
       OR o.lon < ${NCR.lonMin} OR o.lon > ${NCR.lonMax}
    ORDER BY o.lat DESC`;

  if (rows.length === 0) {
    console.log('✓ No out-of-NCR outlets found. Nothing to fix.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Found ${rows.length} outlet(s) outside Metro Manila bounds:\n`);
  for (const r of rows) {
    console.log(`  ${r.outlet_name}  [${r.brand ?? 'unknown brand'}]`);
    console.log(`     id=${r.id}  lat=${r.lat}  lon=${r.lon}\n`);
  }

  if (doDelete) {
    const ids = rows.map((r) => r.id);
    const res = await prisma.outlet.deleteMany({ where: { id: { in: ids } } });
    console.log(`Deleted ${res.count} out-of-NCR outlet(s).`);
  } else {
    console.log('To DELETE these rows, re-run with --delete:');
    console.log('  npx tsx --tsconfig tsconfig.scripts.json scripts/findOutliers.ts --delete');
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
