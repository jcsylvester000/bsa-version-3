/**
 * Re-score every analysed site with the CURRENT composite rules — no module re-run, no OSM calls.
 *
 *   npm run db:recompute-composites           # all sites
 *   npm run db:recompute-composites -- --dry  # show what would change
 *
 * Use after a scoring-rule change such as the 2026-10-07 territory deal-breaker (a site that
 * redistributes its own sales is capped to No-Go; a "mixed" territory call to Caution). Reads each
 * site's stored module scores and rewrites candidate_site.composite_score / verdict through the same
 * function the pipeline uses (scorecardServer.recomputeSiteComposite). Idempotent.
 */
import 'dotenv/config';
import { prisma } from '@/lib/db/prisma';
import { recomputeSiteComposite } from '@/lib/modules/scorecardServer';
import { siteCompositeFromModules } from '@/lib/modules/scorecard';
import type { TruthLayer } from '@/lib/truth/truthLayer';

async function main() {
  const dry = process.argv.includes('--dry');
  const sites = await prisma.candidateSite.findMany({ select: { id: true, label: true, compositeScore: true, verdict: true } });
  let changed = 0;
  for (const s of sites) {
    const before = { c: s.compositeScore != null ? Number(s.compositeScore) : null, v: s.verdict };
    let after: { composite: number | null; band: string };
    if (dry) {
      const rows = await prisma.moduleResult.findMany({ where: { candidateSiteId: s.id, module: { not: 'analysis' } }, select: { module: true, score: true, truthLayer: true } });
      after = siteCompositeFromModules(rows.map((r) => ({ module: r.module, score: r.score != null ? Number(r.score) : null, truthLayer: r.truthLayer as TruthLayer, note: '' })));
    } else {
      after = await recomputeSiteComposite(s.id);
    }
    const v = after.band === 'insufficient' ? null : after.band;
    if (before.c !== after.composite || before.v !== v) {
      changed++;
      console.log(`${dry ? '[dry] ' : ''}${s.label}: ${before.c ?? '—'} ${before.v ?? '—'} → ${after.composite ?? '—'} ${v ?? '—'}`);
    }
  }
  console.log(`\n${sites.length} sites checked, ${changed} ${dry ? 'would change' : 'updated'}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
