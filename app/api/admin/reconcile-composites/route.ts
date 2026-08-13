import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { ok, errors } from '@/lib/api/respond';
import { siteCompositeFromModules, type ModuleScore } from '@/lib/modules/scorecard';
import type { TruthLayer } from '@/lib/truth/truthLayer';

// Allow a longer execution for a full backfill across every run.
export const maxDuration = 60;

/**
 * POST /api/admin/reconcile-composites — one-time backfill so EXISTING runs stop
 * showing the dashboard-vs-scorecard contradiction.
 *
 * New runs already store the all-module composite (orchestrator recompute). This
 * endpoint applies the SAME math to runs that were scored before the fix: for every
 * candidate site it reads the persisted module_results, recomputes the weighted
 * composite + band (identical to the scorecard), and updates the stored
 * compositeScore/verdict. Deterministic, DB-only — no OSM, no external calls.
 *
 * Any signed-in user may run it; it only reconciles the user's own visible data and
 * never fabricates scores (sites with no scored modules are left untouched).
 */
export async function POST(_req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const sites = await prisma.candidateSite.findMany({
    select: { id: true, label: true, compositeScore: true, verdict: true },
  });

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  const changes: Array<{ site: string; from: number | null; to: number | null; verdict: string | null }> = [];

  for (const site of sites) {
    const rows = await prisma.moduleResult.findMany({
      where: { candidateSiteId: site.id },
      select: { module: true, score: true, truthLayer: true },
    });
    if (!rows.length) { skipped++; continue; }

    const moduleScores: ModuleScore[] = rows.map((r) => ({
      module: r.module,
      score: r.score != null ? Number(r.score) : null,
      truthLayer: r.truthLayer as TruthLayer,
      note: '',
    }));
    const { composite, band } = siteCompositeFromModules(moduleScores);
    if (composite == null) { skipped++; continue; }

    const prev = site.compositeScore != null ? Number(site.compositeScore) : null;
    const verdict = band === 'insufficient' ? null : band;
    // Only write when something actually changes (avoid churn).
    if (prev != null && Math.abs(prev - composite) < 0.05 && site.verdict === verdict) {
      unchanged++;
      continue;
    }
    await prisma.candidateSite.update({
      where: { id: site.id },
      data: { compositeScore: composite, verdict: verdict ?? undefined },
    });
    updated++;
    if (changes.length < 50) changes.push({ site: site.label, from: prev, to: composite, verdict });
  }

  return ok({ totalSites: sites.length, updated, unchanged, skipped, sample: changes });
}
