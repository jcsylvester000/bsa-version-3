import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { safeQuery } from '@/lib/db/safeQuery';
import { DEMO_RUNS } from '@/lib/mock/demoData';
import { DEMO_RUN_ID, mockTerritoryGuard, mockLeaseBenchmark } from '@/lib/mock/mockCompute';
import { buildDashboard, type ModuleResultLite } from '@/lib/modules/dashboard';
import { siteCompositeFromModules, type ModuleScore } from '@/lib/modules/scorecard';
import { RunDashboard } from '@/components/RunDashboard';
import type { TruthLayer } from '@/lib/truth/truthLayer';

export const dynamic = 'force-dynamic';

export default async function RunsPage({ searchParams }: { searchParams: { runId?: string } }) {
  const session = await getSession();
  const runId = searchParams.runId;

  // --- Demo user only: show the sample dashboard for the demo run -----------
  // Real registered accounts fall through to the DB path and start empty.
  if (isMockUser(session) && (!runId || runId === DEMO_RUN_ID)) {
    const dash = await buildMockDashboard();
    return (
      <>
        <RunDashboard
          runId={DEMO_RUN_ID}
          brandName="Macao Imperial Tea"
          vertical="fnb_cafe"
          siteCount={2}
          data={dash}
          mock
        />
      </>
    );
  }

  // --- DB mode ---------------------------------------------------------------
  // Only hit the DB when runId is a real UUID. A stray non-UUID (e.g. the demo run id
  // reaching a real account) would otherwise crash the page on a UUID parse error.
  if (runId && isUuid(runId)) {
    const run = await prisma.pipelineRun.findUnique({
      where: { id: runId },
      include: { franchisor: { select: { brandName: true } }, _count: { select: { sites: true } }, intake: { select: { id: true, version: true } } },
    });
    if (run && session && canAccessRun(session, run)) {
      const rows = await prisma.moduleResult.findMany({
        where: { pipelineRunId: runId },
        include: { site: { select: { id: true, label: true, city: true, compositeScore: true, verdict: true } } },
      });
      const lite: ModuleResultLite[] = rows.map((r) => ({
        module: r.module,
        score: r.score != null ? Number(r.score) : null,
        truthLayer: r.truthLayer as TruthLayer,
        flags: r.flags,
        payload: (r.payload ?? {}) as Record<string, unknown>,
        site: {
          id: r.site.id, label: r.site.label, city: r.site.city,
          composite: r.site.compositeScore != null ? Number(r.site.compositeScore) : null,
          verdict: r.site.verdict,
        },
      }));
      const dash = buildDashboard(lite);
      return (
        <>
          <RunDashboard
            runId={run.id}
            runName={run.name ?? null}
            createdAt={run.createdAt ? run.createdAt.toISOString() : null}
            brandName={run.franchisor.brandName}
            vertical={run.vertical}
            siteCount={run._count.sites}
            data={dash}
            intakeId={run.intake?.id ?? null}
            version={run.intake?.version ?? 1}
          />
        </>
      );
    }
  }

  // --- Run picker (no run selected) -----------------------------------------
  // Staff (admin/analyst) see everything. Every other account sees STRICTLY the runs it
  // created — nothing else. (We deliberately dropped the old "also show unowned/legacy
  // runs for my franchisor" fallback: it caused ownerless test/debris runs to appear in
  // every account. Real runs always carry createdByUserId from the intake flow.)
  const scoped =
    session!.role === 'admin' || session!.role === 'analyst'
      ? {}
      : { createdByUserId: session!.id };
  const { data: dbRuns } = await safeQuery(
    () =>
      prisma.pipelineRun.findMany({
        where: scoped, orderBy: { createdAt: 'desc' }, take: 50,
        include: { franchisor: { select: { brandName: true } }, _count: { select: { sites: true } }, intake: { select: { version: true, parentIntakeId: true, id: true } } },
      }),
    [] as Awaited<ReturnType<typeof getRunsType>>,
  );
  const usingMock = isMockUser(session) && dbRuns.length === 0;
  const runs = usingMock
    ? DEMO_RUNS.map((r) => ({ id: r.id, name: null as string | null, franchisor: { brandName: r.brandName }, vertical: r.vertical, status: r.status, _count: { sites: r.siteCount }, createdAt: null as Date | null, intake: null as { version: number } | null }))
    : dbRuns.map((r) => ({ id: r.id, name: r.name as string | null, franchisor: r.franchisor, vertical: r.vertical, status: r.status, _count: r._count, createdAt: r.createdAt as Date | null, intake: r.intake ? { version: r.intake.version } : null }));

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink-text">Analysis Runs</h1>
          <p className="text-sm text-ink-muted">Open a run to see its Site Intelligence Dashboard.</p>
        </div>
        <Link href="/intake" className="btn-accent">New Intake</Link>
      </div>
      {runs.length === 0 ? (
        <div className="card p-8 text-center text-ink-muted">No runs yet. Start with a new intake.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {runs.map((r) => (
            <Link key={r.id} href={`/runs?runId=${r.id}`} className="card p-4 transition hover:bg-ink-hover">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-ink-text">{r.name ?? r.franchisor.brandName}</p>
                {r.intake && r.intake.version > 1 && <span className="shrink-0 rounded bg-ink-panel-2 px-1.5 py-0.5 text-[11px] text-accent">v{r.intake.version}</span>}
              </div>
              <p className="text-xs text-ink-muted">{r.franchisor.brandName} · {r.vertical} · {r._count.sites} sites · {r.status}</p>
              {r.createdAt && <p className="mt-1 text-[11px] text-ink-muted">{new Date(r.createdAt).toLocaleString()}</p>}
              <p className="mt-3 text-sm text-accent">Open dashboard →</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// helper type for safeQuery fallback
const getRunsType = () =>
  prisma.pipelineRun.findMany({
    include: { franchisor: { select: { brandName: true } }, _count: { select: { sites: true } }, intake: { select: { version: true, parentIntakeId: true, id: true } } },
  });

/** Build the dashboard data for the mock demo run from mock compute. */
async function buildMockDashboard() {
  const tg = await mockTerritoryGuard(1500);
  const lease = mockLeaseBenchmark('mock-s1', 'BGC', 'inline', { baseRentPhpSqm: 1450, escalationPct: 5, cusaPhpSqm: 180, leaseTermYears: 7 });
  const lite: ModuleResultLite[] = [];
  for (const r of tg.results) {
    // site_fit pillar read (catchment/competition/accessibility) — the RAW site-fit score.
    const siteFitScore = r.site.label.includes('BGC') ? 58 : 81;
    // Collect this site's module scores so the composite reflects EVERY module — the same
    // all-module weighting the real path and the scorecard use — instead of site_fit alone.
    // This keeps the demo dashboard internally consistent with its own scorecard (a heavy
    // territory overlap can't read "81 GO" on one screen and "caution" on another).
    const moduleScores: ModuleScore[] = [
      { module: 'site_fit', score: siteFitScore, truthLayer: 'verified', note: '' },
      { module: 'territory', score: r.maxOverlapPct, truthLayer: 'projected', note: '' },
    ];
    if (r.site.label.includes('BGC')) {
      moduleScores.push({ module: 'lease', score: lease.baseRentPercentile ?? 0, truthLayer: 'assumed', note: '' });
      moduleScores.push({ module: 'daypart', score: 76, truthLayer: 'projected', note: '' });
    }
    const { composite, band } = siteCompositeFromModules(moduleScores);
    const verdict = band === 'insufficient' ? 'caution' : band;
    const site = { id: r.candidateSiteId, label: r.site.label, city: null, composite, verdict };

    lite.push({ module: 'territory', score: r.maxOverlapPct, truthLayer: 'projected', flags: r.flags, payload: r as unknown as Record<string, unknown>, site });
    lite.push({ module: 'site_fit', score: siteFitScore, truthLayer: 'verified', flags: [], payload: { composite: siteFitScore, verdict }, site });
    if (r.site.label.includes('BGC')) {
      lite.push({ module: 'lease', score: lease.baseRentPercentile ?? 0, truthLayer: 'assumed', flags: lease.flags, payload: lease as unknown as Record<string, unknown>, site });
      lite.push({ module: 'daypart', score: 76, truthLayer: 'projected', flags: [], payload: { windowMatchPct: 76 }, site });
    }
  }
  return buildDashboard(lite);
}
