import Link from 'next/link';
import { Panel, ScoreBar, TruthMixBar } from '@/components/ui/Panel';
import { VerdictPill, TruthChip } from '@/components/ui/Chips';
import { StatTile } from '@/components/ui/StatTile';
import { RunPipelineButton } from '@/components/RunPipelineButton';
import { VersionHistory } from '@/components/VersionHistory';
import { RunNameEditor } from '@/components/RunNameEditor';
import { InfoHint } from '@/components/InfoHint';
import { humanizeVertical } from '@/lib/modules/verticalConfig';
import type { DashboardData } from '@/lib/modules/dashboard';

const SEV_FILL: Record<string, string> = { go: 'bg-go text-go', caution: 'bg-caution text-caution', nogo: 'bg-nogo text-nogo' };
const SEV_ICON: Record<string, string> = { go: '✓', caution: '▲', nogo: '✕' };

/**
 * Site Dashboard — run view. v2 leads with the verdict strip (top site + Proceed / Caution / No-Go
 * counts) so the call is readable in under 5 seconds, then the ranked shortlist, then context.
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
  const confLabel = conf === 'high' ? 'High' : conf === 'low' ? 'Low' : 'Medium';
  const count = (v: 'go' | 'caution' | 'nogo') => data.ranked.filter((s) => s.verdict === v).length;
  const noVerdict = data.ranked.filter((s) => s.verdict == null).length;
  const top = data.ranked[0];

  return (
    <div className="space-y-7">
      {/* Header */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="overline flex items-center gap-2.5">
            {brandName} · {humanizeVertical(vertical)}
            {version > 1 && <span className="rounded-chip bg-ink-hover px-2 py-0.5 tracking-normal text-accent-text">v{version}</span>}
            {mock && <span>· Demo</span>}
          </p>
          {mock ? (
            <h1 className="text-h1">Site Dashboard</h1>
          ) : (
            <RunNameEditor runId={runId} initialName={runName} fallback={`${brandName} — Site Intelligence`} createdAt={createdAt} />
          )}
          <p className="text-body text-ink-muted">{siteCount} candidate site{siteCount === 1 ? '' : 's'} evaluated · Truth Layer active</p>
        </div>
        <div className="flex flex-wrap gap-3">
          {!mock && intakeId && (
            <Link href={`/intake?edit=${intakeId}`} className="btn-secondary btn-lg" title="Load these inputs, edit, and run a new version">✎ Edit & rerun</Link>
          )}
          {!mock && <RunPipelineButton runId={runId} />}
          <Link href={`/reports?runId=${runId}`} className="btn-primary btn-lg">Run report (all sites)</Link>
        </div>
      </div>

      {/* Verdict strip — the 5-second read */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(0,1fr))]">
        <div className="card flex flex-col gap-2.5 p-5 sm:col-span-3 lg:col-span-1">
          <span className="overline">Top site</span>
          {top && top.composite != null ? (
            <>
              <span className="font-heading text-h2">{top.label}</span>
              <span className="flex items-center gap-3">
                <VerdictPill verdict={top.verdict} />
                <span className="text-[28px] font-semibold tabular-nums">{Math.round(top.composite)}</span>
                <span className="text-body text-ink-muted">/ 100</span>
              </span>
            </>
          ) : (
            <span className="text-body text-ink-muted">{data.topSiteFit.note ?? 'Run the analysis to rank the sites.'}</span>
          )}
        </div>
        {([
          ['go', '✓ Proceed', 'shadow-[inset_0_4px_0_rgb(var(--go))]', 'text-go'],
          ['caution', '▲ Proceed with caution', 'shadow-[inset_0_4px_0_rgb(var(--caution))]', 'text-caution'],
          ['nogo', '✕ No-Go', 'shadow-[inset_0_4px_0_rgb(var(--nogo))]', 'text-nogo'],
        ] as const).map(([k, label, bar, fg]) => (
          <div key={k} className={`card flex flex-col gap-2 p-5 ${bar}`}>
            <span className={`text-body font-semibold ${fg}`}>{label}</span>
            <span className="text-5xl font-semibold leading-none tabular-nums">{count(k)}</span>
            <span className="text-label font-normal text-ink-muted">site{count(k) === 1 ? '' : 's'}</span>
          </div>
        ))}
      </div>
      {noVerdict > 0 && (
        <p className="text-label font-normal text-ink-muted">— {noVerdict} site{noVerdict === 1 ? '' : 's'} without a call yet (not enough data).</p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Ranked shortlist */}
        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pb-3.5 pt-5">
            <h2 className="inline-flex items-center gap-2 text-h2">
              Ranked site shortlist
              <InfoHint text="Each site's composite score (0–100) blends the pillar scores — demand, competition, lease, daypart. Higher = better fit. Select a site to open its Final Report." />
            </h2>
            <span className="text-label font-normal text-ink-muted">Composite 0–100 · higher = better fit</span>
          </div>
          {data.ranked.length === 0 ? (
            <div className="empty-state m-6 mt-0">
              <p className="text-title">No results yet</p>
              <p className="text-body text-ink-muted">Run the analysis to score the candidate sites.</p>
            </div>
          ) : (
            <>
              <div className="table-head hidden grid-cols-[40px_minmax(0,1fr)_150px_150px_16px] gap-4 px-6 py-3 md:grid">
                <span>Rank</span><span>Site</span><span>Recommendation</span><span>Score ↓</span><span />
              </div>
              <ol>
                {data.ranked.map((s, i) => {
                  const inner = (
                    <>
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-ink-hover text-[15px] font-semibold">{i + 1}</span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-body font-semibold">{s.label}</span>
                        <span className="text-label font-normal text-ink-muted">{[s.city, ...s.highlights].filter(Boolean).join(' · ') || '—'}</span>
                      </span>
                      <span className="justify-self-start"><VerdictPill verdict={s.verdict} /></span>
                      <span className="flex items-center gap-2.5">
                        <span className="w-10 text-2xl font-semibold tabular-nums">{s.composite != null ? Math.round(s.composite) : '—'}</span>
                        <span className="flex-1"><ScoreBar score={s.composite ?? 0} band={s.verdict ?? undefined} /></span>
                      </span>
                      {!mock && <span className="hidden text-xl text-ink-muted md:block" aria-hidden>›</span>}
                    </>
                  );
                  const cls = 'grid min-h-[76px] grid-cols-[40px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 px-6 py-3 md:grid-cols-[40px_minmax(0,1fr)_150px_150px_16px]';
                  return (
                    <li key={s.siteId}>
                      {mock ? (
                        <div className={`table-row ${cls}`}>{inner}</div>
                      ) : (
                        // v2: open the site on its Final Report tab (see PATCHES.md → SiteIntelligenceTabs initialTab).
                        <Link href={`/site?runId=${runId}&siteId=${s.siteId}&tab=analysis`} className={`table-row ${cls}`}>{inner}</Link>
                      )}
                    </li>
                  );
                })}
              </ol>
              {!mock && <p className="border-t border-ink-border px-6 py-3.5 text-label font-normal text-ink-muted">Select a site to open its Final Report.</p>}
            </>
          )}
        </section>

        {/* Right rail */}
        <div className="space-y-5">
          <Panel title="Truth Layer quality" subtitle="Every data point classified before it reaches a score">
            <TruthMixBar pct={data.truthMix.pct} />
            <p className="mt-3 border-t border-ink-border pt-3 text-label font-normal text-ink-muted">
              Run confidence: <b className="text-ink-text">{confLabel}</b>
            </p>
          </Panel>

          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Territory conflicts" value={data.territoryConflicts} sub="overlap with own outlets" accent={data.territoryConflicts > 0 ? 'nogo' : 'go'} />
            {/* Neutral colour on purpose: rent position is a statement, not a status (no price verdicts — PATCHES §1h). */}
            <StatTile label="Rent above median" value={data.leaseOutliers} sub="vs corridor benchmark" />
          </div>

          {!mock && intakeId && <VersionHistory intakeId={intakeId} currentRunId={runId} />}

          <Panel title="Alerts" subtitle="Signals surfaced by the modules">
            {data.alerts.length === 0 ? (
              <p className="text-body text-ink-muted">No alerts on this run.</p>
            ) : (
              <ul className="space-y-4">
                {data.alerts.slice(0, 6).map((a, i) => {
                  const [bg, fg] = SEV_FILL[a.severity].split(' ');
                  return (
                    <li key={i} className="flex gap-3">
                      <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-on-status ${bg}`} aria-hidden>{SEV_ICON[a.severity]}</span>
                      <div className="min-w-0 space-y-1">
                        <p className="text-body font-semibold">{a.title}</p>
                        <p className="text-label font-normal text-ink-muted">{a.detail}</p>
                        <p className="flex items-center gap-2 text-label font-normal">
                          <span className={fg}>{a.moduleLabel}</span>
                          <TruthChip layer={a.truthLayer} />
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
