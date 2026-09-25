/**
 * Sites service (F-47). One authorized data path for the per-site intelligence page: it resolves the
 * run, the site, its outlets/module rows/run-mates and the selectable lease corridors in a single
 * place, with access scoping. Returns a discriminated result so the page maps each case to its own
 * empty-state copy without re-implementing the queries.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { canAccessRun, type SessionUser } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { corridorsForRegion } from '@/lib/geo/regions';

type SiteRow = NonNullable<Awaited<ReturnType<typeof loadSite>>>;
type RunRow = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

function loadRun(runId: string) {
  return prisma.pipelineRun.findUnique({ where: { id: runId }, include: { franchisor: { select: { brandName: true } } } });
}
function loadSite(siteId: string) {
  return prisma.candidateSite.findUnique({
    where: { id: siteId },
    select: { id: true, label: true, city: true, siteType: true, lat: true, lon: true, pipelineRunId: true, verdict: true, compositeScore: true, analyzedAt: true, region: true },
  });
}

export interface SiteReport {
  run: RunRow;
  site: SiteRow;
  outlets: Array<{ id: string; outletName: string; lat: number; lon: number; format: string | null }>;
  rows: Array<{ module: string; score: unknown; truthLayer: string; flags: string[]; payload: unknown }>;
  runSites: Array<{ id: string; compositeScore: { toString(): string } | null }>;
  leaseCorridors: string[];
}
export type SiteReportResult = { kind: 'ok'; data: SiteReport } | { kind: 'need_params' | 'not_uuid' | 'not_found' | 'forbidden' | 'site_not_in_run' };

export async function getSiteReport(session: SessionUser | null, runId?: string, siteId?: string): Promise<SiteReportResult> {
  if (!runId || !siteId) return { kind: 'need_params' };
  if (!isUuid(runId) || !isUuid(siteId)) return { kind: 'not_uuid' };

  const run = await loadRun(runId);
  if (!run) return { kind: 'not_found' };
  if (!session || !canAccessRun(session, run)) return { kind: 'forbidden' };

  const site = await loadSite(siteId);
  if (!site || site.pipelineRunId !== runId) return { kind: 'site_not_in_run' };

  const [outlets, rows, runSites] = await Promise.all([
    prisma.outlet.findMany({
      where: { franchisorId: run.franchisorId, status: 'open', OR: [{ intakeSubmissionId: null }, { intakeSubmissionId: run.intakeSubmissionId }] },
      select: { id: true, outletName: true, lat: true, lon: true, format: true },
    }),
    prisma.moduleResult.findMany({
      where: { candidateSiteId: siteId },
      select: { module: true, score: true, truthLayer: true, flags: true, payload: true },
    }),
    prisma.candidateSite.findMany({ where: { pipelineRunId: runId }, select: { id: true, compositeScore: true } }),
  ]);

  // F-40: corridors that have comps for this site's format, region's registry corridors first.
  const compCorridors = await prisma.leaseComp.findMany({
    where: site.siteType ? { format: site.siteType } : {},
    select: { corridor: true }, distinct: ['corridor'], orderBy: { corridor: 'asc' },
  });
  const compSet = compCorridors.map((c) => c.corridor).filter((c): c is string => !!c);
  const regionCorridors = corridorsForRegion(site.region).filter((c) => compSet.includes(c));
  const leaseCorridors = Array.from(new Set([...regionCorridors, ...compSet]));

  return { kind: 'ok', data: { run, site, outlets, rows, runSites, leaseCorridors } };
}
