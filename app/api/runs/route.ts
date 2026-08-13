import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { ok, errors } from '@/lib/api/respond';

/**
 * GET /api/runs — list pipeline runs the session can see. Grid staff see all; everyone
 * else sees only the runs THEY created (plus any legacy runs for their own franchisor
 * that predate ownership tracking). Mirrors the My Runs page scope exactly so the API
 * and the UI never disagree.
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  // Staff see all; everyone else sees strictly the runs they created. (No legacy
  // ownerless-run fallback — it leaked test/debris runs into every account.)
  const scoped = session.role === 'admin' || session.role === 'analyst'
    ? {}
    : { createdByUserId: session.id };

  const runs = await prisma.pipelineRun.findMany({
    where: scoped,
    orderBy: { createdAt: 'desc' },
    include: {
      franchisor: { select: { brandName: true } },
      _count: { select: { sites: true } },
    },
    take: 50,
  });

  return ok({
    runs: runs.map((r) => ({
      id: r.id,
      brandName: r.franchisor.brandName,
      vertical: r.vertical,
      status: r.status,
      confidence: r.confidence,
      exclusivityRadiusM: r.exclusivityRadiusM,
      siteCount: r._count.sites,
      createdAt: r.createdAt,
    })),
  });
}
