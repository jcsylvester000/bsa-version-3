/**
 * Populate demographic_cell.age_profile.
 *
 * F-18: prefer a REAL PSA age-sex table when one is provided, and fall back to the modelled
 * proxy only where real data is missing — so the age profile is honestly labelled per cell:
 *   - Real  → basis 'PSA census age-sex table', truthLayer 'verified'.
 *   - Proxy → basis 'modelled from income band (PSA-anchored)', truthLayer 'projected'.
 *
 * Real data file (optional): prisma/data/demographics/age_profile.real.json
 *   { "<psgc_code>": { "p0_14": 27.4, "p15_44": 45.1, "p45plus": 27.5 }, ... }
 * Percentages per barangay PSGC; they need not sum to exactly 100 (normalised on load).
 * See that folder's README for the format. When the file is absent every cell uses the proxy,
 * exactly as before.
 *
 *   npm run db:enrich-age
 *
 * Idempotent: overwrites age_profile for every cell each run. Safe to re-run.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const REAL_AGE_FILE = join(__dirname, 'data', 'demographics', 'age_profile.real.json');

/** Load the real PSA age table if present. Returns an empty map (→ all-proxy) when absent/invalid. */
function loadRealAges(): Record<string, { p0_14: number; p15_44: number; p45plus: number }> {
  try {
    const raw = JSON.parse(readFileSync(REAL_AGE_FILE, 'utf8')) as Record<string, { p0_14: number; p15_44: number; p45plus: number }>;
    const out: Record<string, { p0_14: number; p15_44: number; p45plus: number }> = {};
    for (const [psgc, v] of Object.entries(raw)) {
      const sum = (v.p0_14 ?? 0) + (v.p15_44 ?? 0) + (v.p45plus ?? 0);
      if (sum <= 0) continue;
      // Normalise to 100 so a table given in raw counts or slightly-off percentages still works.
      out[psgc] = {
        p0_14: Math.round((v.p0_14 / sum) * 1000) / 10,
        p15_44: Math.round((v.p15_44 / sum) * 1000) / 10,
        p45plus: Math.round((v.p45plus / sum) * 1000) / 10,
      };
    }
    return out;
  } catch {
    return {};
  }
}

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
  const real = loadRealAges();
  const realCount = Object.keys(real).length;
  console.log(realCount > 0
    ? `Real PSA age table found: ${realCount} barangays → used where the PSGC matches; modelled proxy elsewhere.`
    : `No real PSA age table (${REAL_AGE_FILE}) — using the modelled income-band proxy for all cells.`);

  const cells = await prisma.demographicCell.findMany({ select: { id: true, psgcCode: true, incomeBand: true } });
  let nReal = 0, nProxy = 0;
  for (const c of cells) {
    const hit = c.psgcCode ? real[c.psgcCode] : undefined;
    const data = hit
      ? { ...hit, basis: 'PSA census age-sex table', truthLayer: 'verified' }
      : { ...(AGE_BY_BAND[(c.incomeBand ?? '').toUpperCase()] ?? DEFAULT), basis: 'modelled from income band (PSA-anchored)', truthLayer: 'projected' };
    await prisma.demographicCell.update({ where: { id: c.id }, data: { ageProfile: data } });
    if (hit) nReal++; else nProxy++;
  }
  console.log(`\n✓ age_profile enriched: ${nReal} from real PSA data (Verified), ${nProxy} modelled (Projected).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
