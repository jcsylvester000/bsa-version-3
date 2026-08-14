import Link from 'next/link';
import { StatTile } from '@/components/ui/StatTile';
import { Panel, ScoreBar } from '@/components/ui/Panel';
import { VerdictPill, TruthChip } from '@/components/ui/Chips';
import { RunPipelineButton } from '@/components/RunPipelineButton';
import { VersionHistory } from '@/components/VersionHistory';
import { RunNameEditor } from '@/components/RunNameEditor';
import { InfoHint } from '@/components/InfoHint';
import { humanizeVertical } from '@/lib/modules/verticalConfig';
import type { DashboardData } from '@/lib/modules/dashboard';

const SEV_DOT: Record<string, string> = { go: 'bg-go', caution: 'bg-caution', nogo: 'bg-nogo' };
const SEV_PILL: Record<string, string> = { go: 'pill-go', caution: 'pill-caution', nogo: 'pill-nogo' };

/**
 * Site Intelligence Dashboard — the command center after a run. Matches the mockup:
 * KPI tiles, ranked shortlist with pillar scores, Truth Layer quality, and the
 * Intelligence Alerts panel where modules surface findings.
 */
export function RunDashboard({
  runId,
  runName = null,
  createdAt = null,
  brandName,
  vertical,
  siteCount,
  data,
  mock = false,
  intakeId = null,
  version = 1,
}: {
  runId: string;
  runName?: string | null;
  createdAt?: string | null;
  brandName: string;
  vertical: string;
  siteCount: number;
  data: DashboardData;
  mock?: boolean;
  intakeId?: string | null;
  version?: number;
}) {
  const conf = data.confidence ?? 'med';
  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-ink-muted">
            {brandName} · {humanizeVertical(vertical)}{version > 1 && <span className="ml-1 rounded bg-ink-panel-2 px-1.5 py-0.5 text-accent">v{version}</span>}{mock && ' · Demo'}
          </p>
          {mock ? (
            <>
              <h1 className="text-2xl font-bold text-ink-text">Site Intelligence Dashboard</h1>
              <p className="text-sm text-ink-muted">{siteCount} candidate site(s) evaluated · Truth Layer active</p>
            </>
          ) : (
            <>
              <RunNameEditor runId={runId} initialName={runName} fallback={`${brandName} — Site Intelligence`} createdAt={createdAt} />
              <p className="text-sm text-ink-muted">{siteCount} candidate site(s) evaluated · Truth Layer active</p>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!mock && intakeId && (
            <Link href={`/intake?edit=${intakeId}`} className="btn-ghost" title="Load these inputs, edit, and run a new version">✎ Edit & rerun</Link>
          )}
          {!mock && <RunPipelineButton runId={runId} />}
          <Link href={`/reports?runId=${runId}`} className="btn-ghost">Site Report</Link>
        </div>
      </div>

      {!mock && intakeId && <VersionHistory intakeId={intakeId} currentRunId={runId} />}

      {/* KPI tiles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Sites cleared GO" value={data.sitesCleared.go} sub={`of ${data.sitesCleared.total} · ${data.sitesCleared.flagged} flagged`} accent="go" />
        <StatTile label="Top site fit" value={data.topSiteFit.score != null ? `${Math.round(data.topSiteFit.score)}` : '—'} sub={data.topSiteFit.score != null ? (data.topSiteFit.site ?? '') : (data.topSiteFit.note ?? 'run the pipeline')} accent="accent" />
        <StatTile label="Territory conflicts" value={data.territoryConflicts} sub="overlap with existing outlets" accent={data.territoryConflicts > 0 ? 'nogo' : 'go'} />
        <StatTile label="Lease outliers" value={data.leaseOutliers} sub="above corridor benchmark" accent={data.leaseOutliers > 0 ? 'caution' : 'go'} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Ranked shortlist */}
        <Panel title={<span className="inline-flex items-center gap-1.5">Ranked site shortlist <InfoHint text="Each site's composite score (0–100) blends the pillar scores — demand, competition, lease, daypart. Higher = better fit. GO ≈ strong, CAUTION ≈ mixed. Click a site to open its full report." /></span>} subtitle="Composite of pillar scores — weighted to your priorities" className="lg:col-span-2">
          {data.ranked.length === 0 ? (
            <p className="text-sm text-ink-muted">No results yet. Run the pipeline to score the candidate sites.</p>
          ) : (
            <>
            <ol className="space-y-3">
              {data.ranked.map((s, i) => {
                const inner = (
                  <>
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-ink-hover text-sm font-semibold text-ink-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium text-ink-text">{s.label}</p>
                        {s.verdict && <VerdictPill verdict={s.verdict} />}
                      </div>
                      <p className="truncate text-xs text-ink-muted">{s.highlights.join(' · ') || s.city || '—'}</p>
                      <div className="mt-2"><ScoreBar score={s.composite ?? 0} band={s.verdict ?? undefined} /></div>
                    </div>
                    <span className="text-2xl font-bold text-ink-text">{s.composite != null ? Math.round(s.composite) : '—'}</span>
                    {!mock && <span className="ml-1 shrink-0 text-ink-muted">›</span>}
                  </>
                );
                return (
                  <li key={s.siteId}>
                    {mock ? (
                      <div className="card-inset flex items-center gap-4 p-3">{inner}</div>
                    ) : (
                      <Link
                        href={`/site?runId=${runId}&siteId=${s.siteId}`}
                        className="card-inset flex items-center gap-4 p-3 transition hover:bg-ink-hover"
                        title="Open the full intelligence report for this site"
                      >
                        {inner}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
            {!mock && <p className="mt-3 text-xs text-ink-muted">Click a site to open its full intelligence report — Territory, Lease, Daypart & White-Space in one view.</p>}
            </>
          )}
        </Panel>

        {/* Truth Layer quality + alerts */}
        <div className="space-y-5">
          <Panel title="Truth Layer quality" subtitle="Every data point classified before it reaches a score">
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="card-inset py-3">
                <p className="text-2xl font-bold text-verified">{data.truthMix.pct.verified}%</p>
                <p className="text-[11px] text-ink-muted">Verified</p>
              </div>
              <div className="card-inset py-3">
                <p className="text-2xl font-bold text-assumed">{data.truthMix.pct.assumed}%</p>
                <p className="text-[11px] text-ink-muted">Assumed</p>
              </div>
              <div className="card-inset py-3">
                <p className="text-2xl font-bold text-projected">{data.truthMix.pct.projected}%</p>
                <p className="text-[11px] text-ink-muted">Projected</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              Confidence on this run: <span className={`font-semibold ${conf === 'high' ? 'text-go' : conf === 'low' ? 'text-nogo' : 'text-caution'}`}>{conf.toUpperCase()}</span>
            </p>
          </Panel>

          <Panel title="Intelligence alerts" subtitle="New signals from the enhanced modules">
            {data.alerts.length === 0 ? (
              <p className="text-sm text-ink-muted">No alerts. Run the pipeline to surface module findings.</p>
            ) : (
              <ul className="space-y-3">
                {data.alerts.slice(0, 6).map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[a.severity]}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-ink-text">{a.title}</p>
                        <span className={`pill ${SEV_PILL[a.severity]} text-[10px]`}>{a.moduleLabel}</span>
                      </div>
                      <p className="text-xs text-ink-muted">{a.detail}</p>
                      <span className="mt-1 inline-block"><TruthChip layer={a.truthLayer} /></span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
