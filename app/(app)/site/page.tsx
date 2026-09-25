import Link from 'next/link';
import { getSession } from '@/lib/auth/session';
import { getSiteReport } from '@/lib/services/sites';
import { SiteIntelligenceTabs, type SiteModulePayloads } from '@/components/SiteIntelligenceTabs';
// Server-safe tab keys. NEVER import runtime values (like TAB_KEYS) from a 'use client' module into
// this Server Component — they arrive as client-reference proxies and throw on use (the #329 crash).
import { isSiteTabKey, type SiteTabKey } from '@/lib/ui/siteTabs';
import { RunPipelineButton } from '@/components/RunPipelineButton';
import { manilaShortStampYear } from '@/lib/util/manilaTime';
import type { TruthLayer } from '@/lib/truth/truthLayer';

export const dynamic = 'force-dynamic';

/**
 * Per-site combined intelligence report. Reached by clicking a site in the Ranked
 * Site Shortlist. Shows Territory Guard, Lease Benchmark, Daypart Demand and
 * White-Space for THAT ONE site, in tabs — all from persisted module_result rows
 * (no Google calls). Falls back gracefully if a module didn't run for the vertical.
 */
export default async function SiteReportPage({ searchParams }: { searchParams: { runId?: string; siteId?: string; tab?: string } }) {
  const session = await getSession();
  const { runId, siteId } = searchParams;
  // `?tab=` opens a specific tab (dashboard links use tab=analysis → Final Report). Validated against
  // the known keys so an arbitrary value can never reach the client component.
  const initialTab: SiteTabKey = isSiteTabKey(searchParams.tab) ? searchParams.tab : 'analysis';

  // One authorized data path (F-47). The service resolves + access-checks the run/site and returns a
  // discriminated result; each case maps to its own empty-state copy here.
  const result = await getSiteReport(session, runId, siteId);
  if (result.kind !== 'ok') {
    const msg =
      result.kind === 'need_params' ? 'Pick a site from the Ranked Site Shortlist on the dashboard.'
        : result.kind === 'not_uuid' ? 'The full per-site report opens on a real run. Submit an intake (or Load a demo scenario) and open a site from the Ranked Site Shortlist.'
          : result.kind === 'not_found' ? 'Run not found.'
            : result.kind === 'forbidden' ? 'You do not have access to this run.'
              : 'Site not found in this run.';
    return <Empty msg={msg} />;
  }
  const { run, site, outlets, rows, runSites, leaseCorridors } = result.data;

  const byModule: Record<string, unknown> = {};
  for (const r of rows) byModule[r.module] = r.payload;

  // Final Report hero context (design v2, README §4). Rank uses the dashboard's ordering
  // (composite desc, unscored last). Truth mix = this site's module-level Truth Layers, the same
  // method the dashboard uses for the run (the 'analysis' row is not a module finding).
  const num = (v: { toString(): string } | null): number | null => (v == null ? null : Number(v.toString()));
  const composite = num(site.compositeScore);
  const ranked = runSites
    .map((s) => ({ id: s.id, composite: num(s.compositeScore) }))
    .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
  const rankIdx = ranked.findIndex((s) => s.id === site.id);
  const layers = rows.filter((r) => r.module !== 'analysis').map((r) => r.truthLayer as TruthLayer);
  const truthPct = layers.length
    ? {
        verified: Math.round((layers.filter((l) => l === 'verified').length / layers.length) * 100),
        assumed: Math.round((layers.filter((l) => l === 'assumed').length / layers.length) * 100),
        projected: Math.round((layers.filter((l) => l === 'projected').length / layers.length) * 100),
      }
    : null;
  const report = {
    composite,
    rank: composite != null && rankIdx >= 0 ? rankIdx + 1 : null,
    total: composite != null ? ranked.length : null,
    confidence: run.confidence ?? null,
    analysedAt: site.analyzedAt ? manilaShortStampYear(site.analyzedAt) : null,
    truthPct,
  };
  const pdfHref = `/api/analysis-report/pdf?runId=${encodeURIComponent(run.id)}&siteId=${encodeURIComponent(site.id)}`;

  const payloads: SiteModulePayloads = {
    territory: (byModule.territory as SiteModulePayloads['territory']) ?? null,
    lease: (byModule.lease as SiteModulePayloads['lease']) ?? null,
    daypart: (byModule.daypart as SiteModulePayloads['daypart']) ?? null,
    whitespace: (byModule.whitespace as SiteModulePayloads['whitespace']) ?? null,
    analysis: (byModule.analysis as SiteModulePayloads['analysis']) ?? null,
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <Link href={`/runs?runId=${run.id}`} className="link inline-flex min-h-tap items-center self-start text-body">← Site Dashboard</Link>
          <p className="overline">{run.franchisor?.brandName ?? 'Unknown brand'}{site.city ? ` · ${site.city}` : ''}</p>
          <h1 className="text-h1">{site.label}</h1>
          <p className="text-body text-ink-muted">Full site intelligence — one site, every module.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <RunPipelineButton runId={run.id} />
          <a href={pdfHref} target="_blank" rel="noopener noreferrer" className="btn-primary btn-lg">Export site PDF</a>
        </div>
      </div>
      <SiteIntelligenceTabs
        site={{ id: site.id, label: site.label, lat: site.lat, lon: site.lon, siteType: site.siteType }}
        outlets={outlets.map((o) => ({ id: o.id, name: o.outletName, lat: o.lat, lon: o.lon, format: o.format }))}
        payloads={payloads}
        vertical={run.vertical}
        verdict={site.verdict ?? null}
        runId={run.id}
        initialTab={initialTab}
        report={report}
        leaseCorridors={leaseCorridors}
      />
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="empty-state items-center text-center">
      <p className="text-body text-ink-muted">{msg}</p>
      <Link href="/runs" className="link inline-flex min-h-tap items-center">← Back to Site Dashboard</Link>
    </div>
  );
}
