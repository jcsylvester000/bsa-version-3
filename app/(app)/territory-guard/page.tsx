import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { DEMO_OUTLETS } from '@/lib/mock/demoData';
import { DEMO_RUN_ID } from '@/lib/mock/mockCompute';
import { resolveDefaultRunId } from '@/lib/modules/defaultRun';
import { TerritoryGuardView } from '@/components/TerritoryGuardView';
import type { MapOutlet } from '@/components/TerritoryMap';

export const dynamic = 'force-dynamic';

const FORMAT_CATCHMENT_M: Record<string, number> = { inline: 900, mall: 1200, kiosk: 600, default: 1000 };
const catchment = (f: string | null) => (f ? FORMAT_CATCHMENT_M[f] ?? 1000 : 1000);

export default async function TerritoryGuardPage({
  searchParams,
}: {
  searchParams: { runId?: string };
}) {
  const session = await getSession();
  // Default to the user's latest accessible run (or the demo run) so the nav item never
  // dead-ends when opened directly.
  const runId = searchParams.runId ?? (await resolveDefaultRunId(session)) ?? undefined;

  if (!runId) {
    return <EmptyState message="No runs yet — start a New Intake to use Territory Guard." />;
  }

  // Mock mode: use in-memory demo outlets, no database.
  if (isMockUser(session) && runId === DEMO_RUN_ID) {
    const mapOutlets: MapOutlet[] = DEMO_OUTLETS.map((o) => ({
      id: o.id,
      name: o.outletName,
      lat: o.lat,
      lon: o.lon,
      catchmentM: catchment(o.format),
    }));
    return (
      <div>
        <div className="mb-6">
          <Link href="/runs" className="text-sm text-accent hover:underline">← Runs</Link>
          <h1 className="mt-2 text-2xl font-bold">Territory Guard — Macao Imperial Tea</h1>
          <p className="text-sm text-ink-muted">
            Stop building branches that eat each other. Overlap % is measured from coordinates (Verified);
            cannibalization ₱ is modelled (Projected). <span className="text-muesli">Mock data.</span>
          </p>
        </div>
        <TerritoryGuardView runId={runId} initialRadiusM={1500} outlets={mapOutlets} />
      </div>
    );
  }

  if (!isUuid(runId)) return <EmptyState message="Open a real run from the Runs list to use Territory Guard." />;
  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } } },
  });
  if (!run) return <EmptyState message="Run not found." />;
  if (!session || !canAccessRun(session, run)) {
    return <EmptyState message="You do not have access to this run." />;
  }

  const outlets = await prisma.outlet.findMany({
    where: { franchisorId: run.franchisorId, status: 'open' },
    select: { id: true, outletName: true, lat: true, lon: true, format: true },
  });

  const mapOutlets: MapOutlet[] = outlets.map((o) => ({
    id: o.id,
    name: o.outletName,
    lat: o.lat,
    lon: o.lon,
    catchmentM: catchment(o.format),
  }));

  return (
    <div>
      <div className="mb-6">
        <Link href="/runs" className="text-sm text-accent hover:underline">
          ← Runs
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Territory Guard — {run.franchisor.brandName}</h1>
        <p className="text-sm text-ink-muted">
          Stop building branches that eat each other. Overlap % is measured from coordinates (Verified); cannibalization
          ₱ is modelled (Projected).
        </p>
      </div>
      <TerritoryGuardView runId={run.id} initialRadiusM={run.exclusivityRadiusM} outlets={mapOutlets} />
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
