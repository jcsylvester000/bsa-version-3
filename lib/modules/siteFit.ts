/**
 * Site-fit compute (server). Builds the scoring pillars for a candidate from
 * reference data — demographic catchment and competitor density near the site —
 * then scores deterministically. Where a reference dataset is empty, the pillar is
 * left null (not guessed) and the row's Truth Layer drops accordingly.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { scoreSiteFit, type Pillar, type SiteFitResult } from './siteFitMath';
import type { TruthLayer } from '@/lib/truth/truthLayer';

export type { SiteFitResult } from './siteFitMath';

const DEMAND_RADIUS_M = 1200;
/**
 * Wider radius for the nearest-cell demand fallback where the layer is thin (F3).
 * Set to cover realistic gaps in the current sparse NCR demographic sample; the real
 * fix is a denser demographic_cell layer (see docs/QA_JOURNEY_FINDINGS.md F3).
 */
const DEMAND_FALLBACK_RADIUS_M = 6000;
const COMPETITOR_RADIUS_M = 800;

interface CountRow { c: number | null }

/**
 * @param conceptCompetitorCount When provided (from the concept-aware Google pull),
 *   the competition pillar counts only GENUINE same-concept competitors near the site
 *   instead of every untyped "competitor" POI — so a milk-tea site isn't penalised for
 *   nearby coffee shops. Falls back to the POI table count when not provided.
 */
export async function runSiteFit(
  candidateSiteId: string,
  conceptCompetitorCount?: number,
): Promise<SiteFitResult> {
  const site = await prisma.candidateSite.findUniqueOrThrow({
    where: { id: candidateSiteId },
    select: { lat: true, lon: true },
  });

  // Demand pillar: population within the catchment (from demographic_cell polygons
  // that contain / are near the site). Verified from PSA when present.
  const demoRows = await prisma.$queryRaw<Array<{ pop: number | null }>>`
    SELECT COALESCE(SUM(population), 0)::int AS pop
    FROM demographic_cell
    WHERE ST_DWithin(
      geom,
      ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography,
      ${DEMAND_RADIUS_M}
    )
  `;
  let population = demoRows[0]?.pop ?? 0;
  let demandTruth: TruthLayer = 'verified';

  // Fallback (Phase 3 QA fix F3): where the demographic layer is thin and no cell is
  // in range, use the NEAREST cell within a wider radius as an Assumed proxy — so a
  // real site isn't scored as if it had zero catchment. Clearly labelled Assumed; it
  // never overrides a real in-range sum.
  if (population <= 0) {
    const nearRows = await prisma.$queryRaw<Array<{ pop: number | null }>>`
      SELECT population::int AS pop
      FROM demographic_cell
      WHERE population IS NOT NULL
        AND ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography,
          ${DEMAND_FALLBACK_RADIUS_M}
        )
      ORDER BY ST_Distance(
        geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography
      ) ASC
      LIMIT 1
    `;
    if (nearRows[0]?.pop != null && nearRows[0].pop > 0) {
      population = nearRows[0].pop;
      demandTruth = 'assumed';
    }
  }
  const hasDemo = population > 0;

  // Competition pillar: prefer the concept-aware count (genuine same-concept
  // competitors from the live Google pull) when the orchestrator supplies it; else
  // fall back to the untyped competitor-POI density in the DB.
  let competitorCount: number;
  let hasPoi: boolean;
  if (conceptCompetitorCount != null) {
    competitorCount = conceptCompetitorCount;
    hasPoi = true; // a concept pull ran → we have a real competition signal
  } else {
    const compRows = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS c
      FROM poi
      WHERE category = 'competitor'
        AND ST_DWithin(
          geom,
          ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography,
          ${COMPETITOR_RADIUS_M}
        )
    `;
    competitorCount = compRows[0]?.c ?? 0;
    hasPoi = await prisma.poi.count({ take: 1 }).then((n) => n > 0);
  }

  // Map raw signals to 0–100 pillar scores (documented, simple, deterministic).
  // Demand: 0 at <2k people in catchment, 100 at >=40k (linear, capped).
  const demandScore = hasDemo ? clamp(((population - 2000) / (40000 - 2000)) * 100) : null;
  // Competition headroom: fewer competitors = more headroom. 100 at 0, 0 at >=12.
  const competitionScore = hasPoi ? clamp(100 - (competitorCount / 12) * 100) : null;
  // Accessibility: placeholder pillar until a transport/road layer is ingested —
  // left null so it neither helps nor invents a signal.
  const accessScore: number | null = null;

  const pillars: Pillar[] = [
    { key: 'demand', label: 'Catchment demand', score: demandScore, weight: 0.5, truthLayer: demandTruth },
    { key: 'competition', label: 'Competition headroom', score: competitionScore, weight: 0.35, truthLayer: 'verified' as TruthLayer },
    { key: 'accessibility', label: 'Accessibility', score: accessScore, weight: 0.15, truthLayer: 'assumed' as TruthLayer },
  ];

  return scoreSiteFit(pillars);
}

export async function persistSiteFit(runId: string, candidateSiteId: string, result: SiteFitResult): Promise<void> {
  await prisma.moduleResult.upsert({
    where: { site_module_key: { candidateSiteId, module: 'site_fit' } },
    update: { score: result.composite ?? undefined, payload: result as unknown as object, truthLayer: result.truthLayer, flags: result.flags },
    create: {
      candidateSiteId,
      pipelineRunId: runId,
      module: 'site_fit',
      score: result.composite ?? undefined,
      payload: result as unknown as object,
      truthLayer: result.truthLayer,
      flags: result.flags,
    },
  });
}

function clamp(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)) * 10) / 10;
}
