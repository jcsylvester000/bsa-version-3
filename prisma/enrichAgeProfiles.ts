/**
 * Populate demographic_cell.age_profile (currently empty) with a MODELLED age-band
 * distribution derived from the cell's income band. Projected: this is a documented proxy
 * (PSA national age structure adjusted by income-band skew — AB/BC skew older/professional,
 * CD/DE skew younger with more dependents), NOT a per-barangay census age table. It fills
 * the gap so the Healthcare module's age/income catchment overlay (F3) can compute, while
 * staying honest — every cell is written truth_layer-projected-equivalent via the note.
 *
 *   npm run db:enrich-age
 *
 * Idempotent: overwrites age_profile for every cell each run. Safe to re-run.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Modelled age bands by income class. Sums to 100. p45plus is the healthcare-relevant cohort.
// Sources of shape: PSA 2020 Census national age structure, skewed by income class
// (higher class → older median age, fewer dependents). Projected.
const AGE_BY_BAND: Record<string, { p0_14: number; p15_44: number; p45plus: number }> = {
  AB: { p0_14: 20, p15_44: 46, p45plus: 34 },
  BC: { p0_14: 24, p15_44: 47, p45plus: 29 },
  CD: { p0_14: 30, p15_44: 46, p45plus: 24 },
  DE: { p0_14: 34, p15_44: 45, p45plus: 21 },
};
const DEFAULT = { p0_14: 30, p15_44: 46, p45plus: 24 };

async function main() {
  const cells = await prisma.demographicCell.findMany({ select: { id: true, incomeBand: true } });
  let n = 0;
  for (const c of cells) {
    const band = (c.incomeBand ?? '').toUpperCase();
    const prof = AGE_BY_BAND[band] ?? DEFAULT;
    await prisma.demographicCell.update({
      where: { id: c.id },
      data: { ageProfile: { ...prof, basis: 'modelled from income band (PSA-anchored)', truthLayer: 'projected' } },
    });
    n++;
  }
  const withAge = await prisma.demographicCell.count({ where: { ageProfile: { not: undefined } } });
  console.log(`\n✓ age_profile enriched: ${n} cells updated (${withAge} now carry an age profile).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
