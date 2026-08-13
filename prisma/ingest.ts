/**
 * Reference-data ingestion CLI.
 *   npm run db:ingest            # loads all sample datasets
 *   npm run db:ingest -- poi     # loads a single dataset
 *
 * Idempotent — safe to re-run. Reads the sample JSON in prisma/data/. In production
 * these loaders are fed by the real source pulls (Overpass / BIR research / PSA).
 */
import 'dotenv/config'; // load .env so DATABASE_URL is available when run via `tsx`
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadPoi, loadZonal, loadDemographics, loadLease, loadMalls } from '../lib/ingest/loaders';

const DATA = path.join(process.cwd(), 'prisma', 'data');
const read = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));
/** Read the real file if present, else fall back to the sample. */
const readReal = (real: string, sample: string) => {
  try { return read(real); } catch { return read(sample); }
};

async function main() {
  const which = process.argv[2];
  const run = async (name: string, fn: () => Promise<unknown>) => {
    if (which && which !== name) return;
    const report = await fn();
    console.log(`  ${name}:`, report);
  };

  console.log('Ingesting reference data (real NCR files where available)…');
  await run('poi', () => loadPoi(read('poi.sample.json')));
  await run('zonal', () => loadZonal(readReal('zonal.real.json', 'zonal.sample.json')));
  await run('demographics', () => loadDemographics(readReal('demographics.real.json', 'demographics.sample.json')));
  await run('lease', () => loadLease(readReal('lease.real.json', 'lease.sample.json')));
  await run('malls', () => loadMalls(read('malls.ncr.json')));
  console.log('Ingestion complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(async () => {
    const { prisma } = await import('@/lib/db/prisma');
    await prisma.$disconnect();
  });
