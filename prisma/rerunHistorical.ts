/**
 * F-18: re-run historical pipeline runs so they carry CURRENT scoring.
 *
 * Older runs were scored before the fix batches (Truth Layer, region scoping, no-fake-zeros,
 * accessibility, etc.), so their module_results and composites are stale. This re-runs each run
 * from scratch (the same `refresh` path the "Re-run analysis" button uses) and drives the
 * time-boxed slices to completion, sequentially, from a script — no HTTP, no session.
 *
 *   npm run db:rerun-historical            # every run
 *   npm run db:rerun-historical -- --status=ready   # only finished runs
 *   npm run db:rerun-historical -- --run=<uuid>     # one run
 *   npm run db:rerun-historical -- --dry             # list what would re-run
 *
 * Idempotent and resumable: safe to re-run; a crash just leaves a run to be picked up next time.
 * Uses the DIRECT (pooled) connection via the normal Prisma client — run it with the same env the
 * app uses. Runs are processed one at a time to stay gentle on Neon and external OSM warming.
 */
import { prisma } from '@/lib/db/prisma';
import { runPipeline } from '@/lib/modules/orchestrator';

interface Args { status?: string; run?: string; dry: boolean }
function parseArgs(argv: string[]): Args {
  const a: Args = { dry: false };
  for (const x of argv) {
    if (x === '--dry') a.dry = true;
    else if (x.startsWith('--status=')) a.status = x.slice('--status='.length);
    else if (x.startsWith('--run=')) a.run = x.slice('--run='.length);
  }
  return a;
}

async function rerunOne(runId: string): Promise<{ status: string; sites: number }> {
  // First slice restarts from scratch; subsequent slices resume until complete.
  let res = await runPipeline(runId, { refresh: true });
  let guard = 0;
  while (!res.complete && guard++ < 50) {
    res = await runPipeline(runId, {});
  }
  return { status: res.status, sites: res.siteCount };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const where = args.run ? { id: args.run } : args.status ? { status: args.status as never } : {};
  const runs = await prisma.pipelineRun.findMany({
    where,
    select: { id: true, name: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Historical re-run — ${runs.length} run(s) selected${args.dry ? ' (dry run — no changes)' : ''}.`);
  if (args.dry) {
    for (const r of runs) console.log(`  • ${r.id}  ${r.status.padEnd(9)}  ${r.name ?? '(unnamed)'}`);
    return;
  }

  let ok = 0, failed = 0;
  for (const r of runs) {
    process.stdout.write(`  • ${r.name ?? r.id} … `);
    try {
      const out = await rerunOne(r.id);
      console.log(`${out.status} (${out.sites} site${out.sites === 1 ? '' : 's'})`);
      out.status === 'failed' ? failed++ : ok++;
    } catch (e) {
      console.log(`FAILED — ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }
  console.log(`\n✓ Done: ${ok} re-run, ${failed} failed.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
