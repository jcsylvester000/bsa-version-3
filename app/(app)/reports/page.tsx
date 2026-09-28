import Link from 'next/link';
import { getSession } from '@/lib/auth/session';
import { isMockUser } from '@/lib/auth/mockUsers';
import { getReportForView } from '@/lib/services/reports';
import { resolveDefaultRunId } from '@/lib/modules/defaultRun';
import { ReportView, ReportBody, type ReportData } from '@/components/ReportView';
import { mockReport } from '@/lib/mock/mockCompute';
import type { TruthLayer } from '@/lib/truth/truthLayer';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }: { searchParams: { runId?: string } }) {
  const session = await getSession();
  // Default to the user's latest accessible run (or the demo run) so the page never dead-ends.
  const runId = searchParams.runId ?? (await resolveDefaultRunId(session)) ?? undefined;
  if (!runId) return <EmptyState message="No runs yet — start a New Intake to generate a report." />;

  // Mock mode: the demo report composed from the mock module results (no database).
  if (isMockUser(session)) {
    const report = await mockReport();
    const data: ReportData = {
      confidence: 'med',
      truthLayerMix: report.truthLayerMix as ReportData['truthLayerMix'],
      sections: report.sections.map((s) => ({
        number: s.number, title: s.title, text: s.text, assessed: s.assessed,
        truthLayers: s.truthLayers as TruthLayer[], metrics: [],
      })),
    };
    return (
      <div className="space-y-6">
        <Header backHref="/runs" brand="Macao Imperial Tea" demo />
        <ReportBody report={data} />
      </div>
    );
  }

  const result = await getReportForView(session, runId);
  if (result.kind !== 'ok') {
    const message =
      result.kind === 'not_uuid' ? 'Open a real run from the Site Dashboard to generate its report.'
        : result.kind === 'not_found' ? 'Run not found.'
          : 'You do not have access to this run.';
    return <EmptyState message={message} />;
  }
  const { run, existing } = result;

  return (
    <div className="space-y-6">
      <Header backHref={`/runs?runId=${run.id}`} brand={run.brandName} />
      <ReportView runId={run.id} existing={existing} />
    </div>
  );
}

function Header({ backHref, brand, demo = false }: { backHref: string; brand: string; demo?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <Link href={backHref} className="link inline-flex min-h-tap items-center self-start text-body">← Site Dashboard</Link>
      <p className="overline">{brand}{demo ? ' · Demo data' : ''}</p>
      <h1 className="text-h1">Run report — all sites</h1>
      <p className="max-w-3xl text-body text-ink-muted">
        Nine sections covering every candidate site in this run, composed from the module results. Every figure keeps its
        Truth Layer. For one site’s call, open the site and use <b className="text-ink-text">Export site PDF</b> on its Final Report.
      </p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="space-y-4">
      <Link href="/runs" className="link inline-flex min-h-tap items-center text-body">← Site Dashboard</Link>
      <div className="empty-state">
        <p className="text-title">No report to show</p>
        <p className="text-body text-ink-muted">{message}</p>
      </div>
    </div>
  );
}
