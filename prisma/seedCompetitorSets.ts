/**
 * Seed the competitor set (cannibalization map) from prisma/data/competitorSets.real.json.
 *
 *   npm run db:seed-cannibalization
 *
 * Idempotent: upserts one row per anchor brand (unique key), so re-running refreshes the
 * competitor tokens / Truth Layer without duplicating. This is the authoritative source
 * for Territory Guard's competitive-saturation read — it defines, per anchor brand, the
 * trade-area set that shares demand, so a NEW brand with no own outlets is scored against
 * real concept-matching competitors nearby instead of a false 0% overlap.
 *
 * Truth Layer is preserved per row exactly as the Cannibalization Map classified it
 * (Verified / Assumed / Projected) — nothing here is invented.
 */
import { PrismaClient, TruthLayer } from '@prisma/client';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

interface Row {
  category: string;
  anchorBrand: string;
  parentOperator: string | null;
  subSegment: string | null;
  formatTier: string | null;
  competitors: string[];
  conceptKey: string;
  truthLayer: string;
  notes: string | null;
}

function asTruth(v: string): TruthLayer {
  const t = (v || '').trim().toLowerCase();
  if (t === 'verified') return TruthLayer.verified;
  if (t === 'projected') return TruthLayer.projected;
  return TruthLayer.assumed;
}

async function main() {
  const file = path.join(process.cwd(), 'prisma', 'data', 'competitorSets.real.json');
  const rows = JSON.parse(readFileSync(file, 'utf8')) as Row[];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('competitorSets.real.json is empty or not an array');
  }

  let upserts = 0;
  const seenConcepts = new Map<string, number>();
  for (const r of rows) {
    if (!r.anchorBrand || !r.conceptKey) {
      console.warn(`  skip: row missing anchorBrand/conceptKey → ${JSON.stringify(r).slice(0, 80)}`);
      continue;
    }
    const competitors = (r.competitors ?? []).map((c) => c.trim()).filter(Boolean);
    await prisma.competitorSet.upsert({
      where: { anchorBrand: r.anchorBrand },
      update: {
        category: r.category,
        conceptKey: r.conceptKey,
        parentOperator: r.parentOperator ?? null,
        subSegment: r.subSegment ?? null,
        formatTier: r.formatTier ?? null,
        competitors,
        truthLayer: asTruth(r.truthLayer),
        notes: r.notes ?? null,
      },
      create: {
        category: r.category,
        conceptKey: r.conceptKey,
        anchorBrand: r.anchorBrand,
        parentOperator: r.parentOperator ?? null,
        subSegment: r.subSegment ?? null,
        formatTier: r.formatTier ?? null,
        competitors,
        truthLayer: asTruth(r.truthLayer),
        notes: r.notes ?? null,
      },
    });
    upserts++;
    seenConcepts.set(r.conceptKey, (seenConcepts.get(r.conceptKey) ?? 0) + 1);
  }

  const total = await prisma.competitorSet.count();
  console.log(`\n✓ competitor_set seeded: ${upserts} anchors upserted, ${total} rows in table.`);
  console.log('  concept coverage:', Object.fromEntries([...seenConcepts.entries()].sort()));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
