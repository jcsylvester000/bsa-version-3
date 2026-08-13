import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { Panel } from '@/components/ui/Panel';
import { InfoHint } from '@/components/InfoHint';
import { TruthChip } from '@/components/ui/Chips';
import { DaypartCurve, type DaypartData } from '@/components/DaypartCurve';
import { AnalysisSequence } from '@/components/AnalysisSequence';
import { daypartCurve } from '@/lib/modules/p2p3Math';
import { resolveDefaultRunId } from '@/lib/modules/defaultRun';

export const dynamic = 'force-dynamic';

export default async function DaypartPage({ searchParams }: { searchParams: { runId?: string } }) {
  const session = await getSession();
  // Default to the user's latest accessible run so a real user sees their own data, not
  // the illustrative demo, when opening this from the nav.
  const runId = searchParams.runId ?? (await resolveDefaultRunId(session)) ?? undefined;

  let brandName = 'Your brand';
  let daytimeShare = 65;
  let windowMatch = 76;
  let persistedHourly: number[] | null = null;
  let truth: 'verified' | 'assumed' | 'projected' = 'projected';
  let siteLabel = 'Proposed — BGC High Street';
  // For a real run, only show a curve when the pipeline actually PRODUCED a daypart
  // result (i.e. the run's vertical activates daypart). Otherwise we say "not assessed"
  // — the same honest read the scorecard and report give — instead of fabricating a
  // default curve. Mock users keep the illustrative demo.
  const isMock = isMockUser(session);
  let notAssessed = false;

  if (!isMock && runId && isUuid(runId)) {
    const run = await prisma.pipelineRun.findUnique({ where: { id: runId }, include: { franchisor: { select: { brandName: true } } } });
    if (run && session && canAccessRun(session, run)) {
      brandName = run.franchisor.brandName;
      const row = await prisma.moduleResult.findFirst({ where: { pipelineRunId: runId, module: 'daypart' }, include: { site: { select: { label: true } } } });
      if (row?.payload) {
        const p = row.payload as { daytimeShare?: number; windowMatchPct?: number; hourly?: number[] };
        daytimeShare = p.daytimeShare ?? daytimeShare;
        windowMatch = p.windowMatchPct ?? windowMatch;
        persistedHourly = Array.isArray(p.hourly) && p.hourly.length === 24 ? p.hourly : null;
        truth = row.truthLayer as typeof truth;
        siteLabel = row.site.label;
      } else {
        // Run exists and we can read it, but this vertical didn't run daypart.
        notAssessed = true;
      }
    }
  }

  // Prefer the persisted curve (single source of truth); fall back to recomputing it.
  const hourly = persistedHourly ?? daypartCurve(daytimeShare);
  const isOfficeLed = daytimeShare >= 50;
  const data: DaypartData = { hourly, window: isOfficeLed ? [11, 14] : [17, 20], windowMatchPct: windowMatch };

  return (
    <div>
      <div className="mb-6">
        {runId && <Link href={`/runs?runId=${runId}`} className="text-sm text-accent hover:underline">← Dashboard</Link>}
        <h1 className="mt-2 text-2xl font-bold text-ink-text">Daypart & Seasonality — {brandName}</h1>
        <p className="text-sm text-ink-muted">
          Reads when demand occurs, not just who lives there — so a dwell-time format lands in a catchment whose peak
          hours match its model. {isMockUser(session) && <span className="text-accent">Mock data.</span>}
        </p>
      </div>

      {notAssessed ? (
        <div className="rounded-lg border border-dashed border-ink-border p-8 text-center text-ink-muted">
          <p className="font-medium text-ink-text">Daypart wasn’t assessed for this run.</p>
          <p className="mt-1 text-sm">This module runs for dwell-time formats (café, QSR, bakery, fitness, education). This run’s vertical doesn’t activate it, so there’s no demand-curve to show — the Scorecard and Report reflect the same.</p>
        </div>
      ) : (
      <AnalysisSequence feature="daypart">
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title={<span className="inline-flex items-center gap-1.5">{`Demand across the day — ${siteLabel}`} <InfoHint text="The curve shows relative footfall/demand hour by hour. The amber band marks your format's peak window; the bar below shows what share of daily demand lands inside it. A high in-peak share means the site's rhythm matches your format — a coffee brand wants a morning peak, a dinner concept an evening one." /></span>} subtitle={isOfficeLed ? 'Office-led catchment · midday peak' : 'Residential catchment · evening peak'} right={<TruthChip layer={truth} />} className="lg:col-span-2">
          <DaypartCurve data={data} />
        </Panel>

        <Panel title="Read">
          <div className="space-y-4">
            <div className="card-inset p-4">
              <p className="stat-label">Peak-hour demand captured</p>
              <p className="stat-value text-verified">{windowMatch}%</p>
              <p className="mt-1 text-xs text-ink-muted">falls inside the format's target window</p>
            </div>
            <div className="card-inset p-4">
              <p className="stat-label">Catchment mix</p>
              <p className="mt-1 text-sm text-ink-text">{Math.round(daytimeShare * 10) / 10}% daytime · {Math.round((100 - daytimeShare) * 10) / 10}% residential</p>
              <p className="mt-1 text-xs text-ink-muted">{isOfficeLed ? 'Office-led — a cafe format fits the midday window.' : 'Residential-led — an evening-weighted format fits better.'}</p>
            </div>
          </div>
        </Panel>
      </div>
      </AnalysisSequence>
      )}
    </div>
  );
}
