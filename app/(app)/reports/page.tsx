import Link from 'next/link';
import { getSession } from '@/lib/auth/session';
import { isMockUser } from '@/lib/auth/mockUsers';
import { getReportForView } from '@/lib/services/reports';
import { resolveDefaultRunId } from '@/lib/modules/defaultRun';
import { ReportView } from '@/components/ReportView';
import { mockReport } from '@/lib/mock/mockCompute';
import { TruthChip } from '@/components/TruthChip';
import type { TruthLayer } from '@/lib/truth/truthLayer';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: { runId?: string } }) {
  const session = await getSession();
  // Default to the user's latest accessible run (or the demo run) so the nav never dead-ends.
  const runId = searchParams.runId ?? (await resolveDefaultRunId(session)) ?? undefined;
  if (!runId) return <EmptyState message="No runs yet — start a New Intake to generate a report." />;

  // Mock mode: render the demo report composed from the mock module results so the
  // full final output is visible with no database.
  if (isMockUser(session)) {
    return (
      <div>
        <div className="mb-6">
          <Link href="/runs" className="text-sm text-accent hover:underline">← Runs</Link>
          <h1 className="mt-2 text-2xl font-bold">Site Intelligence Report — Macao Imperial Tea</h1>
          <p className="text-sm text-ink-muted">
            Nine sections composed from the demo module results. <span className="text-muesli">Mock data</span> — connect
            Postgres to generate a downloadable report.
          </p>
        </div>
        <>
          <MockReport />
        </>
      </div>
    );
  }

  const result = await getReportForView(session, runId);
  if (result.kind !== 'ok') {
    const message =
      result.kind === 'not_uuid' ? 'Open a real run from the Runs list to generate its report.'
        : result.kind === 'not_found' ? 'Run not found.'
          : 'You do not have access to this run.';
    return <EmptyState message={message} />;
  }
  const { run, existing } = result;

  return (
    <div>
      <div className="mb-6">
        <Link href="/runs" className="text-sm text-accent hover:underline">
          ← Runs
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Run Report (all sites) — {run.brandName}</h1>
        <p className="text-sm text-ink-muted">
          Nine sections covering every candidate site in this run, composed from the module results. Every number keeps
          its Truth Layer; the cover carries the confidence read. For one site&apos;s written analysis, open the site and
          use Export site PDF on its Analysis tab.
        </p>
      </div>
      <>
        <ReportView runId={run.id} existing={existing} />
      </>
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

/** Renders the demo report (mock mode) — the full final output, no database. */
async function MockReport() {
  const report = await mockReport();
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-ink-border bg-ink-panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-ink-muted">Overall confidence</p>
            <p className="text-2xl font-bold text-caution">Medium</p>
          </div>
          <div className="flex gap-2 text-sm">
            <span className="tl-chip tl-verified">{report.truthLayerMix.verified} Verified</span>
            <span className="tl-chip tl-assumed">{report.truthLayerMix.assumed} Assumed</span>
            <span className="tl-chip tl-projected">{report.truthLayerMix.projected} Projected</span>
          </div>
        </div>
      </div>
      <div className="space-y-4">
        {report.sections.map((s) => (
          <section key={s.number} className="rounded-xl border border-ink-border bg-ink-panel p-5">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-ink-text">{s.number}. {s.title}</h3>
              <div className="flex gap-1">
                {s.truthLayers.map((l) => (
                  <TruthChip key={l} layer={l as TruthLayer} />
                ))}
              </div>
            </div>
            <p className={`whitespace-pre-wrap text-sm ${s.assessed ? 'text-ink-text' : 'italic text-ink-muted'}`}>{s.text}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
