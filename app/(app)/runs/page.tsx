import Link from 'next/link';
import { getSession } from '@/lib/auth/session';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { getRunDashboard, listRunsForUser, getRunSiteSummaries } from '@/lib/services/runs';
import { manilaShortStampYear } from '@/lib/util/manilaTime';
import { DEMO_RUNS } from '@/lib/mock/demoData';
import { DEMO_RUN_ID, mockTerritoryGuard, mockLeaseBenchmark } from '@/lib/mock/mockCompute';
import { buildDashboard, type ModuleResultLite } from '@/lib/modules/dashboard';
import { siteCompositeFromModules, type ModuleScore } from '@/lib/modules/scorecard';
import { RunDashboard } from '@/components/RunDashboard';
import { humanizeVertical } from '@/lib/modules/verticalConfig';

export const dynamic = 'force-dynamic';

export default async function RunsPage({ searchParams }: { searchParams: { runId?: string; q?: string; brand?: string } }) {
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

  // --- DB mode: a specific run's dashboard (F-47: one authorized service path) --------------
  if (runId && isUuid(runId)) {
    const dash = await getRunDashboard(session, runId);
    if (dash) {
      const { run, data, analysedSites } = dash;
      return (
        <>
          <RunDashboard
            runId={run.id}
            runName={run.name ?? null}
            createdAt={run.createdAt ? run.createdAt.toISOString() : null}
            brandName={run.franchisor?.brandName ?? 'Unknown brand'}
            vertical={run.vertical}
            siteCount={run._count.sites}
            data={data}
            intakeId={run.intake?.id ?? null}
            version={run.intake?.version ?? 1}
            status={run.status}
            analysedSites={analysedSites}
          />
        </>
      );
    }
  }

  // --- Run picker (no run selected) -----------------------------------------
  // Staff see all; everyone else only the runs they created (the service enforces this).
  const dbRuns = await listRunsForUser(session!);
  const usingMock = isMockUser(session) && dbRuns.length === 0;
  const allRuns = usingMock
    ? DEMO_RUNS.map((r) => ({ id: r.id, name: null as string | null, franchisor: { brandName: r.brandName }, vertical: r.vertical, status: r.status as string, _count: { sites: r.siteCount }, createdAt: null as Date | null, intake: null as { version: number } | null }))
    : dbRuns.map((r) => ({ id: r.id, name: r.name as string | null, franchisor: r.franchisor ?? { brandName: 'Unknown brand' }, vertical: r.vertical, status: r.status as string, _count: r._count, createdAt: r.createdAt as Date | null, intake: r.intake ? { version: r.intake.version } : null }));

  // Per-run result counts + area (design v2 · B3). One flat read of the listed runs' sites via the
  // service (≤ 50 runs × 5 sites) — no include/transaction, safe under the Neon HTTP adapter.
  const siteRows = await getRunSiteSummaries(allRuns.map((r) => r.id));
  const summary = new Map<string, { go: number; caution: number; nogo: number; cities: string[] }>();
  for (const s of siteRows) {
    const e = summary.get(s.pipelineRunId) ?? { go: 0, caution: 0, nogo: 0, cities: [] };
    if (s.verdict === 'go' || s.verdict === 'caution' || s.verdict === 'nogo') e[s.verdict]++;
    if (s.city && !e.cities.includes(s.city)) e.cities.push(s.city);
    summary.set(s.pipelineRunId, e);
  }

  // Search + brand filter (plain GET form — works without JS).
  const q = (searchParams.q ?? '').trim().toLowerCase();
  const brandFilter = searchParams.brand ?? '';
  const brands = [...new Set(allRuns.map((r) => r.franchisor.brandName))].sort();
  const runs = allRuns.filter((r) => {
    if (brandFilter && r.franchisor.brandName !== brandFilter) return false;
    if (!q) return true;
    const hay = [r.name ?? '', r.franchisor.brandName, ...(summary.get(r.id)?.cities ?? [])].join(' ').toLowerCase();
    return hay.includes(q);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-h1">Site Dashboard</h1>
          <p className="text-body text-ink-muted">Your analysis runs. Open one to see the ranked sites and each site’s call.</p>
        </div>
        <Link href="/intake" className="btn-primary btn-lg self-start sm:self-auto">+ New Intake</Link>
      </div>

      {allRuns.length === 0 ? (
        // H1 — no runs yet
        <div className="empty-state items-start">
          <p className="text-title">No runs yet</p>
          <p className="max-w-xl text-body text-ink-muted">
            Start a New Intake: pick a brand, add up to 5 candidate sites, and BSA gives each one a clear call.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-4">
            <Link href="/intake" className="btn-primary btn-lg">Start New Intake</Link>
            <Link href="/screening" className="link inline-flex min-h-tap items-center">Or browse Franchise Screening ›</Link>
          </div>
        </div>
      ) : (
        <>
          <form method="get" role="search" className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1">
              <span className="sr-only">Search by run, brand or city</span>
              <input name="q" defaultValue={searchParams.q ?? ''} placeholder="⌕  Search by run, brand or city" className="field" />
            </label>
            <label className="sm:w-64">
              <span className="sr-only">Brand</span>
              <select name="brand" defaultValue={brandFilter} className="field">
                <option value="">All brands</option>
                {brands.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <button type="submit" className="btn-secondary btn-lg">Filter</button>
          </form>

          {runs.length === 0 ? (
            <div className="empty-state">
              <p className="text-title">No runs match</p>
              <p className="text-body text-ink-muted">Try a different search or brand.</p>
              <Link href="/runs" className="link inline-flex min-h-tap items-center self-start">Clear filters</Link>
            </div>
          ) : (
            <section className="card overflow-hidden">
              <div className="table-head hidden grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_64px_minmax(0,1.3fr)_150px_16px] gap-4 px-6 py-3 md:grid">
                <span>Run</span><span>Brand</span><span>Sites</span><span>Result</span><span>Last run ↓</span><span />
              </div>
              <ul>
                {runs.map((r) => {
                  const sm = summary.get(r.id);
                  const status = r.status === 'ready' ? null : r.status === 'failed' ? 'Failed' : 'Analysing…';
                  return (
                    <li key={r.id}>
                      <Link
                        href={`/runs?runId=${r.id}`}
                        className="table-row grid min-h-[76px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-6 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_64px_minmax(0,1.3fr)_150px_16px]"
                      >
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex items-center gap-2 text-body font-semibold text-ink-text">
                            <span className="truncate">{r.name ?? r.franchisor.brandName}</span>
                            {r.intake && r.intake.version > 1 && <span className="shrink-0 rounded-chip bg-ink-hover px-1.5 py-0.5 text-chip text-accent-text">v{r.intake.version}</span>}
                          </span>
                          <span className="truncate text-label font-normal text-ink-muted">
                            {[humanizeVertical(r.vertical), ...(sm?.cities.slice(0, 3) ?? [])].join(' · ')}
                          </span>
                        </span>
                        <span className="hidden truncate text-body text-ink-text md:block">{r.franchisor.brandName}</span>
                        <span className="hidden text-body tabular-nums md:block">{r._count.sites}</span>
                        <span className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-label md:col-span-1">
                          {status ? (
                            <span className={r.status === 'failed' ? 'font-semibold text-nogo' : 'font-semibold text-caution'}>
                              {r.status === 'failed' ? '✕ ' : '◌ '}{status}
                            </span>
                          ) : sm && sm.go + sm.caution + sm.nogo > 0 ? (
                            <>
                              {sm.go > 0 && <span className="font-semibold text-go">✓ {sm.go} Proceed</span>}
                              {sm.caution > 0 && <span className="font-semibold text-caution">▲ {sm.caution} Caution</span>}
                              {sm.nogo > 0 && <span className="font-semibold text-nogo">✕ {sm.nogo} No-Go</span>}
                            </>
                          ) : (
                            <span className="text-ink-muted">— No calls yet</span>
                          )}
                        </span>
                        <span className="hidden text-label font-normal text-ink-muted md:block">{r.createdAt ? manilaShortStampYear(new Date(r.createdAt)) : '—'}</span>
                        <span className="hidden text-xl text-ink-muted md:block" aria-hidden>›</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

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
