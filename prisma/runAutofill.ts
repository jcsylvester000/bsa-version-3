/**
 * Work the automated POI back-fill queue from the command line (local dev, or a server without the
 * Netlify schedule). Same guard rails as the schedule: switch, daily cap, OpenStreetMap status.
 *
 *   npm run autofill:run               # one pass (~20 s)
 *   npm run autofill:run -- --passes=6 # several passes back to back (~2 min)
 */
import 'dotenv/config';
import { prisma } from '@/lib/db/prisma';
import { runAutofill } from '@/lib/services/autofill';

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--passes='));
  const passes = Math.max(1, Math.min(30, Number(arg?.slice(9) ?? 1) || 1));
  for (let i = 0; i < passes; i++) {
    const r = await runAutofill({ trigger: 'admin', budgetMs: 20_000 });
    console.log(`pass ${i + 1}:`, JSON.stringify(r));
    if (!r.job && !r.refreshed.length) break;
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
