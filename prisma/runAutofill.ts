/**
 * Work the automated POI back-fill queue from the command line (local dev, a data-team computer, or a
 * scheduled CI job). Same guard rails as the Netlify schedule: switch, daily cap, OpenStreetMap status.
 *
 *   npm run autofill:run                          # one pass (~20 s), like the 10-minute schedule
 *   npm run autofill:run -- --passes=6            # several passes back to back
 *   npm run autofill:run -- --patient --passes=30 # data-team runner (Brief C-5): up to 2 min per pass and
 *                                                 # 50 s per layer — finishes jobs a 10–26 s serverless
 *                                                 # function cannot while public OpenStreetMap is slow
 *
 * Also queues the 90-day refresh of stale areas (Brief C-4). Stops early when there is nothing left to do.
 * While OpenStreetMap is busy, a pass reports it and jobs keep waiting (no attempt is used).
 */
import 'dotenv/config';
import { prisma } from '@/lib/db/prisma';
import { runAutofill } from '@/lib/services/autofill';

async function main() {
  const arg = process.argv.find((a) => a.startsWith('--passes='));
  const patient = process.argv.includes('--patient');
  const passes = Math.max(1, Math.min(patient ? 200 : 30, Number(arg?.slice(9) ?? 1) || 1));
  let busyStreak = 0;
  for (let i = 0; i < passes; i++) {
    const r = await runAutofill({ trigger: patient ? 'runner' : 'admin', budgetMs: patient ? 120_000 : 20_000, patient });
    console.log(`pass ${i + 1}:`, JSON.stringify(r));
    if (r.skipped && /busy|unreachable/i.test(r.skipped) && patient) {
      // Wait for OpenStreetMap rather than hammering it; give up after ~10 minutes of busy.
      if (++busyStreak >= 5) { console.log('OpenStreetMap still busy — stopping; run again later.'); break; }
      await new Promise((res) => setTimeout(res, 120_000));
      continue;
    }
    busyStreak = 0;
    if (!r.job && !r.refreshed.length && !r.staleQueued) break;
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
