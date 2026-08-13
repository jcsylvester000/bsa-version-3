/**
 * Server side of F9 — gather a run's module_results per site and build a scorecard
 * for each. Deterministic; no AI. The scorecard is a franchisee-facing artifact.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { buildScorecard, type Scorecard, type ModuleScore } from './scorecard';
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
      return `Base rent at the ${payload.baseRentPercentile ?? '?'}th percentile, "${hz(payload.verdict)}".`;
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

  const scorecards: Scorecard[] = [];
  for (const site of sites) {
    const rows = await prisma.moduleResult.findMany({
      where: { candidateSiteId: site.id },
      select: { module: true, score: true, truthLayer: true, payload: true },
    });
    const moduleScores: ModuleScore[] = rows.map((r) => ({
      module: r.module,
      score: r.score != null ? Number(r.score) : null,
      truthLayer: r.truthLayer as TruthLayer,
      note: noteFor(r.module, (r.payload ?? {}) as Record<string, unknown>),
    }));
    scorecards.push(buildScorecard(site.label, moduleScores));
  }
  return scorecards;
}
