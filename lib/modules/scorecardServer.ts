/**
 * Server side of F9 — gather a run's module_results per site and build a scorecard
 * for each. Deterministic; no AI. The scorecard is a franchisee-facing artifact.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { buildScorecard, siteCompositeFromModules, type Scorecard, type ModuleScore } from './scorecard';
import type { TruthLayer } from '@/lib/truth/truthLayer';

// Humanize a raw verdict/enum for display — turns "above_market" → "above market",
// so a viewer never sees snake_case codes in the scorecard notes.
function hz(v: unknown): string {
  return String(v ?? '?').replace(/_/g, ' ');
}

function noteFor(module: string, payload: Record<string, unknown>): string {
  switch (module) {
    case 'site_fit': return `Composite ${payload.composite ?? '?'}/100, verdict "${hz(payload.verdict)}".`;
    case 'territory': return `Max overlap ${payload.maxOverlapPct ?? '?'}%, verdict "${hz(payload.verdict)}".`;
    case 'lease': {
      const st = payload.baseRentStats as { median?: number; min?: number; max?: number; n?: number } | undefined;
      // When the user hasn't entered an asking rent, show the corridor's own range/median
      // as the market read — useful even without a percentile.
      if (payload.verdict === 'corridor_benchmark' && st?.median != null) {
        return `Corridor rent ₱${Math.round(st.min ?? 0).toLocaleString()}–₱${Math.round(st.max ?? 0).toLocaleString()}/sqm, median ₱${Math.round(st.median).toLocaleString()} (n=${st.n ?? 0}). Enter your asking rent to benchmark against it.`;
      }
      return `Base rent at the ${payload.baseRentPercentile ?? '?'}th percentile of the corridor (scored as value: lower rent vs corridor scores higher).`;
    }
    case 'daypart': return `Window match ${payload.windowMatchPct ?? '?'}%.`;
    case 'informal': return `${payload.totalEstimated ?? '?'} est. competitors${payload.onGroundCheckAdvised ? '; on-ground check advised' : ''}.`;
    case 'land': return `Land screen "${hz(payload.verdict)}".`;
    default: return 'Assessed.';
  }
}

export async function buildScorecardsForRun(runId: string): Promise<Scorecard[]> {
  const sites = await prisma.candidateSite.findMany({
    where: { pipelineRunId: runId },
    select: { id: true, label: true },
  });
  // One query for every site's rows (was one query per site).
  const rows = await prisma.moduleResult.findMany({
    where: { candidateSiteId: { in: sites.map((s) => s.id) }, module: { not: 'analysis' } },
    select: { candidateSiteId: true, module: true, score: true, truthLayer: true, payload: true },
  });
  return sites.map((site) => {
    const moduleScores: ModuleScore[] = rows
      .filter((r) => r.candidateSiteId === site.id)
      .map((r) => ({
        module: r.module,
        score: r.score != null ? Number(r.score) : null,
        truthLayer: r.truthLayer as TruthLayer,
        note: noteFor(r.module, (r.payload ?? {}) as Record<string, unknown>),
      }));
    return buildScorecard(site.label, moduleScores);
  });
}

/**
 * Recompute and store ONE site's composite + verdict from its current module scores — the same
 * math the scorecard shows. Called by the pipeline after each site and by any route that
 * changes a module score afterwards (e.g. the user entering an asking rent on the Lease tab),
 * so the dashboard headline and the scorecard can never drift apart.
 * A site with nothing scorable is cleared (composite + verdict null), never left stale.
 */
export async function recomputeSiteComposite(siteId: string): Promise<{ composite: number | null; band: Scorecard['band'] }> {
  const rows = await prisma.moduleResult.findMany({
    where: { candidateSiteId: siteId, module: { not: 'analysis' } },
    select: { module: true, score: true, truthLayer: true },
  });
  const { composite, band } = siteCompositeFromModules(
    rows.map((r) => ({ module: r.module, score: r.score != null ? Number(r.score) : null, truthLayer: r.truthLayer as TruthLayer, note: '' })),
  );
  await prisma.candidateSite.update({
    where: { id: siteId },
    data: { compositeScore: composite, verdict: band === 'insufficient' ? null : band },
  });
  return { composite, band };
}
