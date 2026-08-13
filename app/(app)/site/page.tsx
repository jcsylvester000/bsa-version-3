import Link from 'next/link';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { SiteIntelligenceTabs, type SiteModulePayloads } from '@/components/SiteIntelligenceTabs';

export const dynamic = 'force-dynamic';

/**
 * Per-site combined intelligence report. Reached by clicking a site in the Ranked
 * Site Shortlist. Shows Territory Guard, Lease Benchmark, Daypart Demand and
 * White-Space for THAT ONE site, in tabs — all from persisted module_result rows
 * (no Google calls). Falls back gracefully if a module didn't run for the vertical.
 */
export default async function SiteReportPage({ searchParams }: { searchParams: { runId?: string; siteId?: string } }) {
  const session = await getSession();
  const { runId, siteId } = searchParams;

  if (!runId || !siteId) {
    return <Empty msg="Pick a site from the Ranked Site Shortlist on the dashboard." />;
  }

  // The DB `id` columns are UUIDs. In mock/demo mode the IDs are placeholders like
  // "mock-run-…" — querying with those makes Prisma throw an invalid-UUID error, so
  // guard the format first and show a friendly note instead of crashing.
  if (!isUuid(runId) || !isUuid(siteId)) {
    return <Empty msg="The full per-site report opens on a real run. Submit an intake (or Load a demo scenario) and open a site from the Ranked Site Shortlist." />;
  }

  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } } },
  });
  if (!run) return <Empty msg="Run not found." />;
  if (!session || !canAccessRun(session, run)) {
    return <Empty msg="You do not have access to this run." />;
  }

  const site = await prisma.candidateSite.findUnique({
    where: { id: siteId },
    select: { id: true, label: true, city: true, siteType: true, lat: true, lon: true, pipelineRunId: true },
  });
  if (!site || site.pipelineRunId !== runId) return <Empty msg="Site not found in this run." />;

  // Own outlets (for the Territory map) + every module result for this one site.
  const [outlets, rows] = await Promise.all([
    prisma.outlet.findMany({
      where: { franchisorId: run.franchisorId, status: 'open' },
      select: { id: true, outletName: true, lat: true, lon: true, format: true },
    }),
    prisma.moduleResult.findMany({
      where: { candidateSiteId: siteId },
      select: { module: true, score: true, truthLayer: true, flags: true, payload: true },
    }),
  ]);

  const byModule: Record<string, unknown> = {};
  for (const r of rows) byModule[r.module] = r.payload;

  const payloads: SiteModulePayloads = {
    territory: (byModule.territory as SiteModulePayloads['territory']) ?? null,
    lease: (byModule.lease as SiteModulePayloads['lease']) ?? null,
    daypart: (byModule.daypart as SiteModulePayloads['daypart']) ?? null,
    whitespace: (byModule.whitespace as SiteModulePayloads['whitespace']) ?? null,
  };

  return (
    <div>
      <div className="mb-6">
        <Link href={`/runs?runId=${runId}`} className="text-sm text-accent hover:underline">← Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold text-ink-text">{site.label}</h1>
        <p className="text-sm text-ink-muted">
          {run.franchisor.brandName}{site.city ? ` · ${site.city}` : ''} · Full site intelligence — one site, every module.
        </p>
      </div>
      <SiteIntelligenceTabs
        site={{ id: site.id, label: site.label, lat: site.lat, lon: site.lon, siteType: site.siteType }}
        outlets={outlets.map((o) => ({ id: o.id, name: o.outletName, lat: o.lat, lon: o.lon, format: o.format }))}
        payloads={payloads}
        vertical={run.vertical}
      />
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-sm text-ink-muted">{msg}</p>
      <Link href="/runs" className="mt-3 inline-block text-sm text-accent hover:underline">← Back to runs</Link>
    </div>
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v: string): boolean {
  return UUID_RE.test(v);
}
