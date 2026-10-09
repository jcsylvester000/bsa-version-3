/**
 * Data-privacy retention for user demand (RA 10173): delete location_demand rows older than N months.
 *
 *   npm run db:purge-demand              # older than 12 months
 *   npm run db:purge-demand -- --months=6
 *
 * Back-fill jobs and the places they saved are not personal data and are kept.
 */
import 'dotenv/config';
import { prisma } from '@/lib/db/prisma';

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--months='));
  const months = Math.max(1, Math.min(60, Number(arg?.slice(9) ?? 12) || 12));
  const n = await prisma.$executeRaw`DELETE FROM location_demand WHERE created_at < now() - make_interval(months => ${months})`;
  console.log(`Deleted ${n} demand row(s) older than ${months} month(s).`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
