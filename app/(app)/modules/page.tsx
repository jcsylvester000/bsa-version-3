import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { resolveDefaultRunId } from '@/lib/modules/defaultRun';
import { MODULE_LABELS } from '@/lib/modules/verticalConfig';
import { ModulesView, type ModuleRow } from '@/components/ModulesView';

export const dynamic = 'force-dynamic';

export default async function ModulesPage({ searchParams }: { searchParams: { runId?: string } }) {
  const session = await getSession();
  const runId = searchParams.runId ?? (await resolveDefaultRunId(session)) ?? undefined;
  if (!runId) return <Empty message="No runs yet — start a New Intake to see module results." />;

  if (isMockUser(session)) {
    return <Empty message="Module results are produced by running the pipeline against a database. In mock mode, use Territory Guard and Lease Benchmark directly, or connect Postgres (AUTH_MODE=db) to run the full pipeline." />;
  }
  if (!isUuid(runId)) return <Empty message="Open a real run from the Runs list to see its module results." />;

  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } } },
  });
  if (!run) return <Empty message="Run not found." />;
  if (!session || !canAccessRun(session, run)) return <Empty message="No access to this run." />;

  const rows = await prisma.moduleResult.findMany({
    where: { pipelineRunId: runId },
    include: { site: { select: { label: true } } },
    orderBy: [{ module: 'asc' }],
  });

  // Shape into a plain, client-safe payload (Decimal → number, BigInt id → string).
  // The payload carries the per-module detail (overlap %, competitor counts, verdicts)
  // the view uses to interpret each score into a broker-meaningful reading.
  const data: ModuleRow[] = rows.map((r) => ({
    id: r.id.toString(),
    module: r.module,
    moduleLabel: MODULE_LABELS[r.module] ?? r.module,
    site: r.site.label,
    score: r.score != null ? Number(r.score) : null,
    truthLayer: r.truthLayer,
    flags: r.flags,
    payload: (r.payload ?? {}) as Record<string, unknown>,
  }));

  return (
    <div>
      <div className="mb-6">
        <Link href={`/runs?runId=${runId}`} className="text-sm text-accent hover:underline">← Runs</Link>
        <h1 className="mt-2 text-2xl font-bold text-ink-text">Module Results — {run.franchisor.brandName}</h1>
        <p className="text-sm text-ink-muted">
          Every deterministic module this run produced, per candidate site, with its Truth Layer. Re-run the pipeline
          from the Runs page to recompute.
        </p>
      </div>

      {data.length === 0 ? (
        <p className="rounded-lg border border-dashed border-ink-border p-8 text-center text-ink-muted">
          No module results yet. Run the pipeline for this run first.
        </p>
      ) : (
        <ModulesView rows={data} />
      )}
    </div>
  );
}

function Empty({ message }: { message: string }) {
  return (
    <div>
      <Link href="/runs" className="text-sm text-accent hover:underline">← Runs</Link>
      <p className="mt-6 rounded-lg border border-dashed border-ink-border p-8 text-center text-ink-muted">{message}</p>
    </div>
  );
}
