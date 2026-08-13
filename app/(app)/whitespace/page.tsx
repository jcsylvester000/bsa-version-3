import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { isUuid } from '@/lib/util/uuid';
import { Panel } from '@/components/ui/Panel';
import { InfoHint } from '@/components/InfoHint';
import { TruthChip } from '@/components/ui/Chips';
import { WhiteSpaceGrid, type Gap } from '@/components/WhiteSpaceGrid';
import { AnalysisSequence } from '@/components/AnalysisSequence';
import { resolveDefaultRunId } from '@/lib/modules/defaultRun';

export const dynamic = 'force-dynamic';

const DEMO_GAPS: Gap[] = [
  { psgcCode: 'g1', barangay: 'Novaliches corridor', population: 52000, opportunityScore: 88, reason: 'high density · no outlet within 2.4 km · 1 competitor' },
  { psgcCode: 'g2', barangay: 'Fairview', population: 41000, opportunityScore: 74, reason: 'high density · nearest competitor 1.8 km' },
  { psgcCode: 'g3', barangay: 'Cainta East', population: 33000, opportunityScore: 61, reason: 'moderate density · 2 competitors nearby' },
];

export default async function WhiteSpacePage({ searchParams }: { searchParams: { runId?: string } }) {
  const session = await getSession();
  // Default to the user's latest accessible run so a real user sees their own data, not
  // the illustrative demo, when opening this from the nav.
  const runId = searchParams.runId ?? (await resolveDefaultRunId(session)) ?? undefined;

  let brandName = 'Your brand';
  let gaps: Gap[] = DEMO_GAPS;
  let truth: 'verified' | 'assumed' | 'projected' = 'projected';
  // For a real run, only show gaps the pipeline actually produced (i.e. the vertical
  // activates white-space). Otherwise say "not assessed" instead of showing demo gaps.
  const isMock = isMockUser(session);
  let notAssessed = false;

  if (!isMock && runId && isUuid(runId)) {
    const run = await prisma.pipelineRun.findUnique({ where: { id: runId }, include: { franchisor: { select: { brandName: true } } } });
    if (run && session && canAccessRun(session, run)) {
      brandName = run.franchisor.brandName;
      const row = await prisma.moduleResult.findFirst({ where: { pipelineRunId: runId, module: 'whitespace' } });
      const payloadGaps = (row?.payload as { gaps?: Gap[] } | undefined)?.gaps;
      if (payloadGaps?.length) {
        gaps = payloadGaps;
        truth = row!.truthLayer as typeof truth;
      } else {
        notAssessed = true;
      }
    }
  }

  return (
    <div>
      <div className="mb-6">
        {runId && <Link href={`/runs?runId=${runId}`} className="text-sm text-accent hover:underline">← Dashboard</Link>}
        <h1 className="mt-2 text-2xl font-bold text-ink-text">Network White-Space — {brandName}</h1>
        <p className="text-sm text-ink-muted">
          Overlays population, competitors and your existing network to rank unserved gaps — network planning, not
          one-off scoring. {isMock && <span className="text-accent">Mock data.</span>}
        </p>
      </div>

      {notAssessed ? (
        <div className="rounded-lg border border-dashed border-ink-border p-8 text-center text-ink-muted">
          <p className="font-medium text-ink-text">White-Space wasn’t assessed for this run.</p>
          <p className="mt-1 text-sm">This module runs for network-expansion formats (convenience, remittance). This run’s vertical doesn’t activate it, so there are no ranked gaps to show — the Scorecard and Report reflect the same.</p>
        </div>
      ) : (
      <AnalysisSequence feature="whitespace">
        <div className="grid gap-5 lg:grid-cols-3">
          <Panel title="Region demand heatmap" subtitle="Darker/amber = higher demand density; numbered = ranked gap" className="lg:col-span-2">
            <WhiteSpaceGrid gaps={gaps} />
          </Panel>

          <Panel title={<span className="inline-flex items-center gap-1.5">Ranked white-space gaps <InfoHint text="Areas of unmet demand where your network has no branch nearby — ranked by demand density minus existing coverage. A high-ranked gap is a strong candidate for expansion: real customers, no cannibalization of your own outlets. These are opportunities, not risks." /></span>} right={<TruthChip layer={truth} />}>
            <ol className="space-y-3">
              {gaps.slice(0, 6).map((g, i) => (
                <li key={g.psgcCode} className="card-inset p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-ink-text">
                      <span className="mr-2 text-accent">#{i + 1}</span>{g.barangay ?? g.psgcCode}
                    </p>
                    <span className="pill pill-go">Priority {i + 1}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{g.reason}</p>
                  <p className="mt-1 text-xs text-ink-muted">Opportunity score {Math.round(g.opportunityScore)}/100</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </AnalysisSequence>
      )}
    </div>
  );
}
