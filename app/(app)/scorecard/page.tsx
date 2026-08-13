import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { buildScorecardsForRun } from '@/lib/modules/scorecardServer';
import { buildScorecard } from '@/lib/modules/scorecard';
import { resolveDefaultRunId } from '@/lib/modules/defaultRun';
import { TruthChip } from '@/components/TruthChip';
import { ScoreBar } from '@/components/ui/Panel';
import { PrintButton } from '@/components/PrintButton';
import type { TruthLayer } from '@/lib/truth/truthLayer';
import type { Scorecard } from '@/lib/modules/scorecard';

export const dynamic = 'force-dynamic';

const BAND: Record<string, { label: string; cls: string }> = {
  go: { label: 'GO', cls: 'bg-go text-white' },
  caution: { label: 'CAUTION', cls: 'bg-caution text-white' },
  nogo: { label: 'NO-GO', cls: 'bg-nogo text-white' },
  insufficient: { label: 'INSUFFICIENT DATA', cls: 'bg-ink-panel-2 text-ink-muted' },
};

export default async function ScorecardPage({ searchParams }: { searchParams: { runId?: string } }) {
  const session = await getSession();
  // Default to the user's latest accessible run (or the demo run) so the nav never dead-ends.
  const runId = searchParams.runId ?? (await resolveDefaultRunId(session)) ?? undefined;
  if (!runId) return <Empty message="No runs yet — start a New Intake to generate a site scorecard." />;

  let brandName = 'Your brand';
  let scorecards: Scorecard[];

  if (isMockUser(session)) {
    // Mock demo scorecard from illustrative module scores.
    scorecards = [
      buildScorecard('Proposed — BGC High Street', [
        { module: 'site_fit', score: 83.2, truthLayer: 'verified', note: 'Composite 83.2/100 — verdict: go.' },
        { module: 'territory', score: 75.2, truthLayer: 'projected', note: 'Max overlap 75.2% — verdict: redistributes existing sales.' },
        { module: 'lease', score: 77.8, truthLayer: 'assumed', note: 'Base rent at the 77.8th percentile — above market.' },
        { module: 'daypart', score: 75.9, truthLayer: 'projected', note: 'Window match 75.9%.' },
        { module: 'informal', score: 60, truthLayer: 'assumed', note: '7 est. competitors; on-ground check advised.' },
      ]),
    ];
  } else if (!isUuid(runId)) {
    return <Empty message="Open a real run from the Runs list to generate its site scorecard." />;
  } else {
    const run = await prisma.pipelineRun.findUnique({ where: { id: runId }, include: { franchisor: { select: { brandName: true } } } });
    if (!run) return <Empty message="Run not found." />;
    if (!session || !canAccessRun(session, run)) return <Empty message="No access to this run." />;
    brandName = run.franchisor.brandName;
    scorecards = await buildScorecardsForRun(runId);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between print:hidden">
        <div>
          <Link href="/runs" className="text-sm text-accent hover:underline">← Runs</Link>
          <h1 className="mt-2 text-2xl font-bold text-ink-text">Site Scorecard — {brandName}</h1>
          <p className="text-sm text-ink-muted">
            A one-page, brand-standard scorecard a franchisee can apply themselves. Weighted from this run’s results,
            with a Go / Caution / No-Go band. {isMockUser(session) && <span className="text-accent">Mock data.</span>}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="space-y-6">
        {scorecards.map((sc, i) => (
          <article key={i} className="card p-6">
            <div className="mb-4 flex items-center justify-between border-b border-ink-border pb-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">{brandName} · Site Scorecard</p>
                <h2 className="text-xl font-bold text-ink-text">{sc.siteLabel}</h2>
              </div>
              <div className="text-right">
                <span className={`inline-block rounded-lg px-4 py-2 text-lg font-bold ${BAND[sc.band].cls}`}>{BAND[sc.band].label}</span>
                <p className="mt-1 text-sm text-ink-muted">Composite <span className="font-semibold text-ink-text">{sc.composite ?? '—'}</span>/100 · <span className="align-middle"><TruthChip layer={sc.truthLayer as TruthLayer} /></span></p>
              </div>
            </div>

            <div className="space-y-3">
              {sc.criteria.map((c) => {
                const band = c.score == null ? undefined : c.score >= 70 ? 'go' : c.score >= 45 ? 'caution' : 'nogo';
                return (
                  <div key={c.key} className="grid grid-cols-12 items-center gap-3 border-b border-ink-border/50 pb-3 last:border-0">
                    <div className="col-span-12 sm:col-span-4">
                      <p className="text-sm font-medium text-ink-text">{c.label}</p>
                      <p className="text-[11px] text-ink-muted">Weight {Math.round(c.weight * 100)}% · {c.truthLayer ? <TruthChip layer={c.truthLayer} /> : <span className="text-ink-muted">not assessed</span>}</p>
                    </div>
                    <div className="col-span-8 sm:col-span-5">
                      {c.score != null ? <ScoreBar score={c.score} band={band} /> : <div className="h-1.5 w-full rounded-full bg-ink-panel-2" />}
                      <p className="mt-1 text-[11px] text-ink-muted">{c.note}</p>
                    </div>
                    <div className="col-span-4 text-right sm:col-span-3">
                      <span className={`text-lg font-bold ${band === 'go' ? 'text-go' : band === 'nogo' ? 'text-nogo' : band === 'caution' ? 'text-caution' : 'text-ink-muted'}`}>
                        {c.score != null ? `${Math.round(c.score)}` : '—'}
                      </span>
                      <span className="text-xs text-ink-muted">{c.score != null ? '/100' : ''}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <p className="mt-4 border-t border-ink-border pt-3 text-xs text-ink-muted">
              Grid Property Ventures · Business Site Analysis. BSA sharpens the shortlist and flags the risks; the broker
              still closes the deal. Verified = measured/sourced · Assumed = estimate with basis · Projected = modelled.
            </p>
          </article>
        ))}
      </div>
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
