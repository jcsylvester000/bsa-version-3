import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { ok, errors } from '@/lib/api/respond';

/**
 * GET /api/admin/data-stats — read-only data-coverage snapshot for QA / observability.
 *
 * Reports how much real data the platform holds right now: POI counts by category, the
 * on-demand cache coverage (poi_coverage cells per vertical, newest fetch), and the
 * reference-data table counts (malls, lease, demographics, zonal, franchisors). Used to
 * measure what brutal-QA report runs actually capture into the shared DB over time.
 *
 * Any signed-in user may read it (counts only, no PII). Never writes.
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  // POI totals + by category.
  const poiTotal = await prisma.poi.count();
  const poiByCategory = await prisma.$queryRaw<Array<{ category: string; n: number }>>`
    SELECT category::text AS category, COUNT(*)::int AS n FROM poi GROUP BY category ORDER BY n DESC`;
  const poiWithGeom = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM poi WHERE geom IS NOT NULL`;

  // On-demand cache coverage — cells warmed per vertical, and the most recent fetch.
  let coverage: Array<{ vertical: string; cells: number; total_poi: number; last_fetched: string | null }> = [];
  let coverageTotal = 0;
  try {
    coverage = await prisma.$queryRaw`
      SELECT vertical, COUNT(*)::int AS cells, COALESCE(SUM(poi_count),0)::int AS total_poi,
             MAX(fetched_at)::text AS last_fetched
      FROM poi_coverage GROUP BY vertical ORDER BY cells DESC`;
    const t = await prisma.poiCoverage.count();
    coverageTotal = t;
  } catch {
    // poi_coverage table may not exist yet (migration not applied) — report as unavailable.
    coverage = [];
    coverageTotal = -1;
  }

  // Reference data.
  const [malls, lease, demographics, zonal, franchisors, franchisorsWithReq, outlets, runs] = await Promise.all([
    prisma.mallProperty.count(),
    prisma.leaseComp.count(),
    prisma.demographicCell.count(),
    prisma.zonalValue.count(),
    prisma.franchisor.count(),
    prisma.franchisor.count({ where: { NOT: { requirements: { equals: Prisma.JsonNull } } } }),
    prisma.outlet.count(),
    prisma.pipelineRun.count(),
  ]);

  // Demographics diagnostics — how many cells have geom, and (for the newest run's
  // franchisor) how many barangays are UNSERVED (>800m from an own outlet) → the White-Space
  // candidate count. This pinpoints why White-Space is empty vs populated.
  const demoGeom = await prisma.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM demographic_cell WHERE geom IS NOT NULL`;
  let whitespaceProbe: unknown = null;
  const latestRun = await prisma.pipelineRun.findFirst({ orderBy: { createdAt: 'desc' }, select: { franchisorId: true, franchisor: { select: { brandName: true } } } });
  if (latestRun) {
    const probe = await prisma.$queryRaw<Array<{ total_cells: number; own_outlets: number; served_lt_800: number; unserved: number }>>`
      SELECT
        (SELECT COUNT(*)::int FROM demographic_cell WHERE geom IS NOT NULL) AS total_cells,
        (SELECT COUNT(*)::int FROM outlet WHERE franchisor_id = ${latestRun.franchisorId}::uuid AND geom IS NOT NULL) AS own_outlets,
        (SELECT COUNT(*)::int FROM demographic_cell d WHERE d.geom IS NOT NULL AND
           (SELECT MIN(ST_Distance(d.geom, o.geom)) FROM outlet o WHERE o.franchisor_id = ${latestRun.franchisorId}::uuid AND o.geom IS NOT NULL) < 800) AS served_lt_800,
        (SELECT COUNT(*)::int FROM demographic_cell d WHERE d.geom IS NOT NULL AND
           COALESCE((SELECT MIN(ST_Distance(d.geom, o.geom)) FROM outlet o WHERE o.franchisor_id = ${latestRun.franchisorId}::uuid AND o.geom IS NOT NULL), 999999) >= 800) AS unserved`;
    whitespaceProbe = { brand: latestRun.franchisor?.brandName, ...probe[0] };
  }

  return ok({
    poi: {
      total: poiTotal,
      withGeom: poiWithGeom[0]?.n ?? 0,
      byCategory: poiByCategory,
    },
    demographics: { total: demographics, withGeom: demoGeom[0]?.n ?? 0, whitespaceProbe },
    cache: {
      coverageTable: coverageTotal >= 0 ? 'present' : 'missing',
      totalCells: coverageTotal,
      byVertical: coverage,
    },
    reference: { malls, lease, demographics, zonal, franchisors, franchisorsWithRequirements: franchisorsWithReq, outlets, runs },
    at: new Date().toISOString(),
  });
}
