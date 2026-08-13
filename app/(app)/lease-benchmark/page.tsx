import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { DEMO_SITES, DEMO_CORRIDORS } from '@/lib/mock/demoData';
import { DEMO_RUN_ID } from '@/lib/mock/mockCompute';
import { resolveDefaultRunId } from '@/lib/modules/defaultRun';
import { resolveCorridorForSite } from '@/lib/modules/leaseMath';
import { LeaseBenchmarkView } from '@/components/LeaseBenchmarkView';

export const dynamic = 'force-dynamic';

export default async function LeaseBenchmarkPage({ searchParams }: { searchParams: { runId?: string } }) {
  const session = await getSession();
  // Default to the user's latest accessible run (or the demo run) so the nav never dead-ends.
  const runId = searchParams.runId ?? (await resolveDefaultRunId(session)) ?? undefined;

  if (!runId) return <EmptyState message="No runs yet — start a New Intake to use Lease Benchmark." />;

  // Mock mode: use in-memory demo sites/corridors, no database.
  if (isMockUser(session) && runId === DEMO_RUN_ID) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/runs" className="text-sm text-accent hover:underline">← Runs</Link>
          <h1 className="mt-2 text-2xl font-bold">Lease Benchmark — Macao Imperial Tea</h1>
          <p className="text-sm text-ink-muted">
            Never negotiate a ten-year lease blind. Comps Verified; fair-range Assumed with sample size.{' '}
            <span className="text-muesli">Mock data (BGC corridor).</span>
          </p>
        </div>
        <LeaseBenchmarkView sites={DEMO_SITES} corridors={DEMO_CORRIDORS} defaultCorridor="BGC" />
      </div>
    );
  }

  if (!isUuid(runId)) return <EmptyState message="Open a real run from the Runs list to use Lease Benchmark." />;
  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } }, sites: { select: { id: true, label: true, siteType: true, city: true } } },
  });
  if (!run) return <EmptyState message="Run not found." />;
  if (!session || !canAccessRun(session, run)) {
    return <EmptyState message="You do not have access to this run." />;
  }

  // Offer the corridors we actually have comps for (honest picker).
  const corridorRows = await prisma.leaseComp.findMany({ distinct: ['corridor'], select: { corridor: true }, orderBy: { corridor: 'asc' } });
  const corridors = corridorRows.map((r) => r.corridor);

  // Preselect the corridor matching the first candidate site's location, so the tool
  // opens benchmarking a BGC site against BGC comps rather than the alphabetically
  // first corridor. Falls back to corridors[0] when the city doesn't map to one we hold.
  const defaultCorridor = resolveCorridorForSite(run.sites[0], corridors, corridors[0] ?? '');

  return (
    <div>
      <div className="mb-6">
        <Link href="/runs" className="text-sm text-accent hover:underline">
          ← Runs
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Lease Benchmark — {run.franchisor.brandName}</h1>
        <p className="text-sm text-ink-muted">
          Never negotiate a ten-year lease blind. Comps are Verified against source leases; the fair-range estimate is
          Assumed and shown with its sample size.
        </p>
      </div>
      <LeaseBenchmarkView
          sites={run.sites}
          corridors={corridors}
          defaultCorridor={defaultCorridor}
        />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div>
      <Link href="/runs" className="text-sm text-accent hover:underline">← Runs</Link>
      <p className="mt-6 rounded-lg border border-dashed border-ink-border p-8 text-center text-ink-muted">{message}</p>
    </div>
  );
}
