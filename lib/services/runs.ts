/**
 * Runs service (F-47). The ONE data path for pipeline-run reads — used by the pages and available to
 * API routes — so access scoping and query shape live in a single, testable place instead of being
 * re-implemented per page. Every function that returns run data enforces `canAccessRun`.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { canAccessRun, type SessionUser } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { safeQuery } from '@/lib/db/safeQuery';
import { buildDashboard, type ModuleResultLite } from '@/lib/modules/dashboard';
import type { TruthLayer } from '@/lib/truth/truthLayer';

/** Single-run dashboard bundle. Returns null when the run is missing or the session can't access it. */
export async function getRunDashboard(session: SessionUser | null, runId: string) {
  if (!session || !isUuid(runId)) return null;
  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } }, _count: { select: { sites: true } }, intake: { select: { id: true, version: true } } },
  });
  if (!run || !canAccessRun(session, run)) return null;

  const rows = await prisma.moduleResult.findMany({
    where: { pipelineRunId: runId, module: { not: 'analysis' } },
    include: { site: { select: { id: true, label: true, city: true, compositeScore: true, verdict: true, pipelineError: true } } },
  });
  const lite: ModuleResultLite[] = rows.map((r) => ({
    module: r.module,
    score: r.score != null ? Number(r.score) : null,
    truthLayer: r.truthLayer as TruthLayer,
    flags: r.flags,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    site: {
      id: r.site.id, label: r.site.label, city: r.site.city,
      composite: r.site.compositeScore != null ? Number(r.site.compositeScore) : null,
      verdict: r.site.verdict,
      pipelineError: r.site.pipelineError,
    },
  }));
  const data = buildDashboard(lite, { runConfidence: run.confidence ?? null });
  const analysedSites = run.status === 'ready'
    ? run._count.sites
    : await prisma.candidateSite.count({ where: { pipelineRunId: run.id, analyzedAt: { not: null } } }).catch(() => null);
  return { run, data, analysedSites };
}

type RunListRow = Awaited<ReturnType<typeof runListQuery>>[number];
const runListQuery = () =>
  prisma.pipelineRun.findMany({
    include: { franchisor: { select: { brandName: true } }, _count: { select: { sites: true } }, intake: { select: { version: true, parentIntakeId: true, id: true } } },
  });

/** The runs a session may list: staff see all, everyone else only the runs they created. Resilient
 *  (returns [] if the DB is unreachable) so the dashboard renders its empty state, not a crash. */
export async function listRunsForUser(session: SessionUser): Promise<RunListRow[]> {
  const scoped = session.role === 'admin' || session.role === 'analyst' ? {} : { createdByUserId: session.id };
  const { data } = await safeQuery(
    () => prisma.pipelineRun.findMany({ where: scoped, orderBy: { createdAt: 'desc' }, take: 50, ...runListQueryInclude }),
    [] as RunListRow[],
  );
  return data;
}
const runListQueryInclude = {
  include: { franchisor: { select: { brandName: true } }, _count: { select: { sites: true } }, intake: { select: { version: true, parentIntakeId: true, id: true } } },
} as const;

/** Verdict/city rollups per run for the listing (one flat read, no transaction). */
export async function getRunSiteSummaries(runIds: string[]): Promise<Array<{ pipelineRunId: string; verdict: string | null; city: string | null }>> {
  const ids = runIds.filter(isUuid);
  if (ids.length === 0) return [];
  const { data } = await safeQuery(
    () => prisma.candidateSite.findMany({ where: { pipelineRunId: { in: ids } }, select: { pipelineRunId: true, verdict: true, city: true } }),
    [] as Array<{ pipelineRunId: string; verdict: string | null; city: string | null }>,
  );
  return data;
}
