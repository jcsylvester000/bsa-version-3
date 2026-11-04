/**
 * Site-fit compute (server). Builds the scoring pillars for a candidate from
 * reference data — demographic catchment and competitor density near the site —
 * then scores deterministically. Where a reference dataset is empty, the pillar is
 * left null (not guessed) and the row's Truth Layer drops accordingly.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { scoreSiteFit, scoreAccessibility, demandPillarScore, competitionPillarScore, type Pillar, type SiteFitResult } from './siteFitMath';
import { tradeAreaRadius } from './scoringConfig';
import type { TruthLayer } from '@/lib/truth/truthLayer';

export type { SiteFitResult } from './siteFitMath';

/** Transport nodes within a short walk count toward the accessibility density (F-15). */
const ACCESS_WALK_M = 500;
/** If NO transport node exists within this window, the layer isn't loaded here (or the site is
 *  off the network) → accessibility stays null rather than inventing a "0". */
const ACCESS_COVERAGE_M = 5000;
/**
 * Wider radius for the nearest-cell demand fallback where the layer is thin (F3).
 * Set to cover realistic gaps in the current sparse NCR demographic sample; the real
 * fix is a denser demographic_cell layer (see docs/QA_JOURNEY_FINDINGS.md F3).
 */
const DEMAND_FALLBACK_RADIUS_M = 6000;

interface CountRow { c: number | null }

/**
 * @param conceptCompetitorCount When provided (concept-aware count from the OpenStreetMap place table),
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
    select: { lat: true, lon: true, siteType: true },
  });
  // Trade area by store format (Brief S-4): 600 m kiosk · 900 m inline · 1.2 km mall · 1 km other.
  // Used for both demand and competition (was a fixed 1,200 m / 800 m for every format).
  const tradeAreaM = tradeAreaRadius(site.siteType);

  // Demand pillar: population within the catchment (from demographic_cell polygons
  // that contain / are near the site). Verified from PSA when present.
  const demoRows = await prisma.$queryRaw<Array<{ pop: number | null; layers: string[] | null }>>`
    SELECT COALESCE(SUM(population), 0)::int AS pop,
           array_agg(DISTINCT truth_layer::text) AS layers
    FROM demographic_cell
    WHERE ST_DWithin(
      geom,
      ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography,
      ${tradeAreaM}
    )
  `;
  let population = demoRows[0]?.pop ?? 0;
  // The demand pillar is only as strong as the weakest demographic row it summed —
  // read from the rows, never assumed Verified.
  const layers = (demoRows[0]?.layers ?? []).filter(Boolean);
  let demandTruth: TruthLayer = layers.includes('projected') ? 'projected' : layers.includes('assumed') || layers.length === 0 ? 'assumed' : 'verified';

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
  // competitors, counted by the orchestrator inside the same trade area) when supplied; else
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
          ${tradeAreaM}
        )
    `;
    competitorCount = compRows[0]?.c ?? 0;
    // Coverage must be LOCAL: "zero competitors" only means something if this area has POI
    // data at all. (Was a global count — any POI anywhere made an uncovered area read as
    // "no competition", scored 100.) Any mapped establishment within 2 km = covered.
    const cover = await prisma.$queryRaw<CountRow[]>`
      SELECT COUNT(*)::int AS c FROM (
        SELECT 1 FROM poi
        WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography, 2000)
        LIMIT 1
      ) x
    `;
    hasPoi = (cover[0]?.c ?? 0) > 0;
  }

  // Map raw signals to 0–100 pillar scores (documented, simple, deterministic).
  // Demand: 0 at <2k people, 100 at >=40k per 1,200 m-circle equivalent (scaled to the trade area).
  const demandScore = hasDemo ? demandPillarScore(population, tradeAreaM) : null;
  // Competition headroom: fewer competitors = more headroom. 100 at 0, 0 at >=12 per 800 m-circle equivalent.
  const competitionScore = hasPoi ? competitionPillarScore(competitorCount, tradeAreaM) : null;
  // Accessibility pillar (F-15): distance to and density of transport nodes near the site.
  // Reads the transport POI layer (category='transport'), which the OSM ingest loads per region
  // (`db:ingest:osm:transport`). When that layer isn't loaded for this area no node is found
  // within the coverage window and the pillar stays null — so scores are unchanged until the
  // transport layer exists, then improve where it does.
  const transRows = await prisma.$queryRaw<Array<{ nearest: number | null; cnt: number | null }>>`
    SELECT MIN(ST_Distance(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography)) AS nearest,
           COUNT(*) FILTER (
             WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography, ${ACCESS_WALK_M})
           )::int AS cnt
    FROM poi
    WHERE category = 'transport'
      AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography, ${ACCESS_COVERAGE_M})
  `;
  const nearestTransportM = transRows[0]?.nearest != null ? Number(transRows[0].nearest) : null;
  const accessScore = scoreAccessibility({
    nearestTransportM,
    countWithinWalkM: transRows[0]?.cnt ?? 0,
    covered: nearestTransportM != null,
  });

  const pillars: Pillar[] = [
    { key: 'demand', label: `Catchment demand (${tradeAreaM.toLocaleString('en-US')} m trade area)`, score: demandScore, weight: 0.5, truthLayer: demandTruth },
    { key: 'competition', label: `Competition headroom (${tradeAreaM.toLocaleString('en-US')} m)`, score: competitionScore, weight: 0.35, truthLayer: 'verified' as TruthLayer },
    { key: 'accessibility', label: 'Accessibility', score: accessScore, weight: 0.15, truthLayer: 'verified' as TruthLayer },
  ];

  return { ...scoreSiteFit(pillars), tradeAreaM };
}

export async function persistSiteFit(runId: string, candidateSiteId: string, result: SiteFitResult): Promise<void> {
  await prisma.moduleResult.upsert({
    where: { site_module_key: { candidateSiteId, module: 'site_fit' } },
    update: { score: result.composite ?? null, payload: result as unknown as object, truthLayer: result.truthLayer, flags: result.flags },
    create: {
      candidateSiteId,
      pipelineRunId: runId,
      module: 'site_fit',
      score: result.composite ?? null,
      payload: result as unknown as object,
      truthLayer: result.truthLayer,
      flags: result.flags,
    },
  });
}

