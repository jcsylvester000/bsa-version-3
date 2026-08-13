/**
 * Seed the NCR/Davao corridor traffic + seasonality reference from
 * prisma/data/trafficSeasonality.real.json.
 *
 *   npm run db:seed-traffic
 *
 * Idempotent: upserts one row per corridor (unique key). This is the dataset that replaces
 * the Land & Traffic module's old POI-count traffic proxy with an AADT-anchored base band
 * plus seasonal low/high multipliers (Christmas peak, Undas exodus/cemetery-spike, Holy Week
 * dip, payday & school-open uplift). Truth Layer preserved per row — a modelled range, never
 * a live count.
 */
import { PrismaClient, FootfallBand, TruthLayer } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

interface Row {
  corridor: string;
  baseBand: string;
  aadtRef: number | null;
  seasonal: unknown;
  truthLayer: string;
  notes: string | null;
  source: string | null;
}

function asBand(v: string): FootfallBand {
  switch ((v || '').trim()) {
    case 'very_high': return FootfallBand.very_high;
    case 'high': return FootfallBand.high;
    case 'low': return FootfallBand.low;
    default: return FootfallBand.medium;
  }
}
function asTruth(v: string): TruthLayer {
  const t = (v || '').trim().toLowerCase();
  if (t === 'verified') return TruthLayer.verified;
  if (t === 'projected') return TruthLayer.projected;
  return TruthLayer.assumed;
}

async function main() {
  const file = path.join(process.cwd(), 'prisma', 'data', 'trafficSeasonality.real.json');
  const rows = JSON.parse(readFileSync(file, 'utf8')) as Row[];
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('trafficSeasonality.real.json is empty');

  let n = 0;
  for (const r of rows) {
    if (!r.corridor || !r.seasonal) { console.warn(`  skip: ${JSON.stringify(r).slice(0, 60)}`); continue; }
    await prisma.trafficCorridor.upsert({
      where: { corridor: r.corridor },
      update: {
        baseBand: asBand(r.baseBand), aadtRef: r.aadtRef ?? null,
        seasonal: r.seasonal as object, truthLayer: asTruth(r.truthLayer),
        notes: r.notes ?? null, source: r.source ?? null,
      },
      create: {
        corridor: r.corridor, baseBand: asBand(r.baseBand), aadtRef: r.aadtRef ?? null,
        seasonal: r.seasonal as object, truthLayer: asTruth(r.truthLayer),
        notes: r.notes ?? null, source: r.source ?? null,
      },
    });
    n++;
  }
  const total = await prisma.trafficCorridor.count();
  console.log(`\n✓ traffic_corridor seeded: ${n} corridors upserted, ${total} rows in table.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
