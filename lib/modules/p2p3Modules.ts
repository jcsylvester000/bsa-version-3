/**
 * P2/P3 server compute modules. Each retrieves from its reference table, runs the
 * pure math, and persists a typed module_result with the architecture's Truth Layer:
 *   - Daypart: peak-hour mix Projected
 *   - Informal: digital Verified, informal estimate Assumed (+ on-ground flag)
 *   - Mall: tier Verified, footfall Assumed → row Assumed
 *   - Healthcare: facility locations Verified, catchment Projected
 *   - White-Space: density/competitor Verified, gap ranking Projected
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { ModuleKind } from '@prisma/client';
import type { TruthLayer } from '@/lib/truth/truthLayer';
import {
  scoreDaypart, scoreInformal, scoreMall, scoreHealthcare, rankWhiteSpace,
  scoreCapacity, type CapacityResult,
  type WhiteSpaceCell, daypartSeasonality,
} from './p2p3Math';
import { scoreLandTraffic, seasonalDemandRange, currentSeason, type CorridorSeasonal } from './landTrafficMath';
import { inferCorridor } from './leaseMath';

async function persist(runId: string, candidateSiteId: string, module: ModuleKind, score: number | null, payload: unknown, truthLayer: TruthLayer, flags: string[]) {
  await prisma.moduleResult.upsert({
    where: { site_module_key: { candidateSiteId, module } },
    update: { score: score ?? undefined, payload: payload as object, truthLayer, flags },
    create: { candidateSiteId, pipelineRunId: runId, module, score: score ?? undefined, payload: payload as object, truthLayer, flags },
  });
}

/** Informal-competitor multipliers by vertical (Assumed, documented). */
const INFORMAL_MULTIPLIER: Record<string, number> = {
  services_salon: 1.8, services_spa: 1.4, services_laundry: 1.6, default: 1.3,
};

// Households needed per service unit to break even, by format (rough operator rule).
// Salon chair turns fewer households than a laundry machine or a water refill line.
const BREAKEVEN_HH_PER_UNIT: Record<string, number> = {
  services_salon: 300, services_laundry: 250, convenience: 400, other: 300, default: 300,
};

export async function runDaypart(runId: string, siteId: string, vertical: string): Promise<void> {
  const site = await prisma.candidateSite.findUniqueOrThrow({ where: { id: siteId }, select: { lat: true, lon: true, city: true, label: true } });
  // Demographic cells are barangay-level and sparse, so a tight radius often catches
  // NONE and yields a degenerate 0% curve. Expand the catchment until we have data:
  // 1200m → 2500m → 4000m, then fall back to the single nearest cell. Wider radii are
  // flagged so the read is honestly marked as coarser.
  const radii = [1200, 2500, 4000];
  let res = 0, day = 0, usedRadius = 0;
  for (const rad of radii) {
    const rows = await prisma.$queryRaw<Array<{ res: number | null; day: number | null }>>`
      SELECT COALESCE(SUM(population),0)::int AS res, COALESCE(SUM(daytime_pop),0)::int AS day
      FROM demographic_cell
      WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography, ${rad})`;
    res = rows[0]?.res ?? 0; day = rows[0]?.day ?? 0; usedRadius = rad;
    if (res + day > 0) break;
  }
  if (res + day === 0) {
    // Last resort: the single nearest demographic cell (any distance), so the module
    // still produces a read instead of a false 0%.
    const near = await prisma.$queryRaw<Array<{ res: number | null; day: number | null; d: number }>>`
      SELECT population::int AS res, daytime_pop::int AS day,
             ST_Distance(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography) AS d
      FROM demographic_cell WHERE geom IS NOT NULL ORDER BY d ASC LIMIT 1`;
    res = near[0]?.res ?? 0; day = near[0]?.day ?? 0; usedRadius = Math.round(near[0]?.d ?? 0);
  }
  const targetWindow = vertical === 'fnb_cafe' || vertical === 'education' ? 'day' : 'allday';
  const r = scoreDaypart({ residentialPop: res, daytimePop: day, targetWindow });
  const flags: string[] = [];
  if (res + day === 0) flags.push('no_demographic_data');
  else if (usedRadius > 1200) flags.push('coarse_demographic_radius'); // used a wider catchment

  // SEASONALITY (the "& Seasonality" half of "Daypart & Seasonality"). Pull the site's
  // corridor seasonal multipliers (from traffic_corridor) and combine with the vertical's
  // term-time sensitivity → a Projected peak/trough season read. When the corridor has no
  // seasonal data we still emit the vertical term-time note.
  const corridorName = inferCorridor(site.city, site.label);
  let seasonalMap: Record<string, { low: number; high: number; label?: string }> | null = null;
  if (corridorName) {
    const tc = await prisma.trafficCorridor.findUnique({ where: { corridor: corridorName }, select: { seasonal: true } });
    seasonalMap = (tc?.seasonal ?? null) as typeof seasonalMap;
  }
  const seasonality = daypartSeasonality(vertical, seasonalMap);
  if (seasonality.peakSeason) flags.push(`season_peak_${seasonality.peakSeason.season}`);

  // Peak-hour mix + seasonality are Projected.
  await persist(runId, siteId, 'daypart', r.windowMatchPct, { ...r, demographicRadiusM: usedRadius, seasonality, corridor: corridorName ?? null }, 'projected', flags);
}

export async function runInformal(runId: string, siteId: string, vertical: string, units?: number | null): Promise<void> {
  const site = await prisma.candidateSite.findUniqueOrThrow({ where: { id: siteId }, select: { lat: true, lon: true } });
  const rows = await prisma.$queryRaw<Array<{ c: number | null }>>`
    SELECT COUNT(*)::int AS c FROM poi
    WHERE category='competitor'
      AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography, 800)`;
  const digital = rows[0]?.c ?? 0;
  const mult = INFORMAL_MULTIPLIER[vertical] ?? INFORMAL_MULTIPLIER.default;
  const r = scoreInformal({ digitalCount: digital, informalMultiplier: mult });
  const flags = r.onGroundCheckAdvised ? ['on_ground_check_advised'] : [];

  // Per-unit capacity read (QA v6) for chair/machine/line formats: pull the tight
  // 800 m resident catchment and turn units → pop-per-unit + breakeven households.
  let capacity: CapacityResult | undefined;
  if (units != null) {
    const popRows = await prisma.$queryRaw<Array<{ p: number | null }>>`
      SELECT COALESCE(SUM(population),0)::int AS p FROM demographic_cell
      WHERE geom IS NOT NULL
        AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography, 800)`;
    const catchmentPop = popRows[0]?.p ?? null;
    capacity = scoreCapacity({ units, catchmentPop, breakevenHouseholdsPerUnit: BREAKEVEN_HH_PER_UNIT[vertical] ?? BREAKEVEN_HH_PER_UNIT.default });
    flags.push(...capacity.flags);
  }

  // Convert the raw competitor COUNT into a 0–100 competition-intensity score for the
  // scorecard (the count itself is not a 0–100 value — it produced the "140/100" bug).
  // Fewer competitors nearby = higher score; it decays as the count rises and floors at
  // 5 so a saturated corridor still reads as "very competitive," not zero. The raw counts
  // remain in the payload for the detailed read.
  const competitionScore = Math.max(5, Math.round(100 / (1 + r.totalEstimated / 12)));
  // Digital Verified, informal estimate Assumed → row Assumed.
  await persist(runId, siteId, 'informal', competitionScore, { ...r, capacity, competitionScore }, 'assumed', flags);
}

export async function runHealthcare(runId: string, siteId: string): Promise<void> {
  const site = await prisma.candidateSite.findUniqueOrThrow({ where: { id: siteId }, select: { lat: true, lon: true } });
  const near = await prisma.$queryRaw<Array<{ dist: number | null; cnt: number | null }>>`
    SELECT MIN(ST_Distance(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography)) AS dist,
           COUNT(*) FILTER (WHERE ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography, 2000))::int AS cnt
    FROM poi WHERE category IN ('hospital','clinic','diagnostic')`;
  const nearestFacilityM = near[0]?.dist != null ? Number(near[0].dist) : null;

  // Residential CATCHMENT overlay (F3): pull population, the dominant income band, and the
  // modelled 45+ age share from demographic_cell within ~1.5 km, so the score reflects the
  // catchment's healthcare DEMAND, not just proximity to referral sources.
  const demo = await prisma.$queryRaw<Array<{ pop: number | null; band: string | null; age45: number | null }>>`
    SELECT COALESCE(SUM(population),0)::int AS pop,
           (SELECT income_band FROM demographic_cell dc2
              WHERE dc2.geom IS NOT NULL
                AND ST_DWithin(dc2.geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography, 1500)
              ORDER BY dc2.population DESC NULLS LAST LIMIT 1) AS band,
           AVG( (age_profile->>'p45plus')::float8 ) AS age45
    FROM demographic_cell
    WHERE geom IS NOT NULL
      AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography, 1500)`;
  const catchmentPopulation = demo[0]?.pop ?? null;
  const incomeBand = demo[0]?.band ?? null;
  const age45PlusPct = demo[0]?.age45 != null ? Number(demo[0].age45) : null;

  const r = scoreHealthcare({
    nearestFacilityM, facilityCountWithin2km: near[0]?.cnt ?? 0,
    catchmentPopulation, incomeBand, age45PlusPct,
  });
  const flags = r.verdict === 'no_data' ? ['no_healthcare_poi'] : [];
  if (r.catchmentScore == null && r.verdict !== 'no_data') flags.push('no_catchment_demographics');
  // Facility locations Verified, catchment Projected → row Projected. Score is the composite.
  await persist(runId, siteId, 'healthcare', r.composite, r, 'projected', flags);
}

export async function runMall(runId: string, siteId: string, targetTier?: string | null): Promise<void> {
  const site = await prisma.candidateSite.findUniqueOrThrow({ where: { id: siteId }, select: { lat: true, lon: true } });
  // Nearest mall_property to the site.
  const rows = await prisma.$queryRaw<Array<{ tier: string; footfall: string; name: string; dist: number }>>`
    SELECT tier::text AS tier, footfall_band::text AS footfall, mall_name AS name,
           ST_Distance(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography) AS dist
    FROM mall_property WHERE geom IS NOT NULL
    ORDER BY dist ASC LIMIT 1`;
  if (rows.length === 0) {
    await persist(runId, siteId, 'mall', null, { verdict: 'no_data', targetTier: targetTier ?? null }, 'projected', ['no_mall_data']);
    return;
  }
  const m = rows[0];
  const r = scoreMall({ tier: m.tier as 'A' | 'B' | 'C', footfallBand: m.footfall as 'very_high' | 'high' | 'medium' | 'low' });
  // Compare the operator's target tier (QA v6 intake) to the nearest mall's actual tier.
  const wanted = parseTargetTier(targetTier);
  const flags: string[] = [];
  let tierMatch: boolean | null = null;
  if (wanted) {
    tierMatch = wanted === m.tier;
    if (!tierMatch) flags.push('target_tier_mismatch');
  }
  // Tier Verified, footfall Assumed → row Assumed.
  await persist(runId, siteId, 'mall', r.score, { ...r, mallName: m.name, distanceM: Math.round(m.dist), targetTier: wanted, tierMatch }, 'assumed', flags);
}

/** Extract an A/B/C target tier from the intake mall-tier string. */
function parseTargetTier(s: string | null | undefined): 'A' | 'B' | 'C' | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (t.includes('tier a') || t.includes('super-regional')) return 'A';
  if (t.includes('tier b') || t.includes('regional')) return 'B';
  if (t.includes('tier c') || t.includes('community') || t.includes('neighbourhood')) return 'C';
  return null;
}

/** Minimum frontage/lot by land-intensive vertical (Assumed, documented). */
const LAND_MINIMUMS: Record<string, { frontageM: number; lotSqm: number }> = {
  fuel: { frontageM: 30, lotSqm: 800 },
  automotive: { frontageM: 20, lotSqm: 500 },
  hotel: { frontageM: 25, lotSqm: 1000 },
  default: { frontageM: 20, lotSqm: 500 },
};

export async function runLand(
  runId: string,
  siteId: string,
  vertical: string,
  parcel?: { frontageM: number | null; lotAreaSqm: number | null },
): Promise<void> {
  const site = await prisma.candidateSite.findUniqueOrThrow({ where: { id: siteId }, select: { lat: true, lon: true, city: true, label: true } });

  // Traffic band — now sourced from the NCR/Davao traffic_corridor reference (AADT-anchored)
  // instead of the old POI-count proxy. Resolve the site's corridor from its city/label
  // (same inference the Lease Benchmark uses), look up the corridor's base band + seasonal
  // multipliers, and derive a season-aware demand range. Falls back to the POI proxy only
  // when no corridor matches, so the screen still produces a band.
  const corridorName = inferCorridor(site.city, site.label);
  let trafficBand: 'very_high' | 'high' | 'medium' | 'low' | 'unknown' = 'unknown';
  let corridorRow: { corridor: string; baseBand: string; aadtRef: number | null; seasonal: unknown; truthLayer: string } | null = null;
  if (corridorName) {
    const tc = await prisma.trafficCorridor.findUnique({
      where: { corridor: corridorName },
      select: { corridor: true, baseBand: true, aadtRef: true, seasonal: true, truthLayer: true },
    });
    if (tc) {
      corridorRow = { corridor: tc.corridor, baseBand: tc.baseBand, aadtRef: tc.aadtRef, seasonal: tc.seasonal, truthLayer: tc.truthLayer };
      trafficBand = tc.baseBand as typeof trafficBand;
    }
  }
  if (!corridorRow) {
    // Fallback: POI-density proxy (kept for corridors/areas without a traffic row).
    const rows = await prisma.$queryRaw<Array<{ c: number | null }>>`
      SELECT COUNT(*)::int AS c FROM poi
      WHERE category IN ('transport','office','mall')
        AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}),4326)::geography, 1000)`;
    const nearby = rows[0]?.c ?? 0;
    trafficBand = nearby >= 6 ? 'high' : nearby >= 3 ? 'medium' : nearby >= 1 ? 'low' : 'unknown';
  }

  // Zoning: commercial classification present in zonal_value for the city → ok.
  const zoning = site.city
    ? await prisma.zonalValue.findFirst({ where: { cityMunicipality: site.city, classificationCode: { startsWith: 'C' } }, select: { id: true } })
    : null;
  const zoningOk = site.city ? zoning != null : null;

  const mins = LAND_MINIMUMS[vertical] ?? LAND_MINIMUMS.default;
  // Frontage/lot now come from the QA-v6 land-parcel intake field when supplied;
  // when absent they stay null and the screen falls back to traffic + zoning.
  const r = scoreLandTraffic({
    // scoreLandTraffic already treats 'very_high' via TRAFFIC_SCORE.
    trafficBand: trafficBand as 'very_high' | 'high' | 'medium' | 'low' | 'unknown',
    frontageM: parcel?.frontageM ?? null, lotAreaSqm: parcel?.lotAreaSqm ?? null, zoningOk,
    minFrontageM: mins.frontageM, minLotSqm: mins.lotSqm,
  });

  // Season-aware demand range for the corridor (Projected). Attach the range, the corridor
  // provenance and today's season so the UI/report can show "Normal vs Christmas vs Undas…".
  const seasonal = (corridorRow?.seasonal ?? null) as CorridorSeasonal | null;
  const seasonRange = corridorRow ? seasonalDemandRange(corridorRow.baseBand, seasonal) : [];
  const now = new Date();
  const nowSeason = currentSeason(now.getMonth() + 1, now.getDate());

  const payload = {
    ...r,
    corridor: corridorRow?.corridor ?? null,
    trafficBand,
    aadtRef: corridorRow?.aadtRef ?? null,
    trafficSource: corridorRow ? 'traffic_corridor (AADT-anchored)' : 'poi_proxy (fallback)',
    trafficTruth: corridorRow ? corridorRow.truthLayer : 'assumed',
    seasonRange,       // [{season, low, high, label}] demand index band
    currentSeason: nowSeason,
  };
  // Zoning/frontage Verified; traffic band Assumed (AADT-anchored) / seasonal range Projected
  // → row carries the softest (Assumed).
  await persist(runId, siteId, 'land', r.composite, payload, 'assumed', r.flags);
}

export async function runWhiteSpace(runId: string, siteId: string, franchisorId: string): Promise<void> {
  // Region-wide gap ranking (site-agnostic, but stored per candidate for the run view).
  const cells = await prisma.$queryRaw<Array<{ psgc: string; brgy: string | null; pop: number; nearest: number | null; comp: number; lat: number | null; lon: number | null }>>`
    SELECT d.psgc_code AS psgc, d.barangay AS brgy, COALESCE(d.population,0)::int AS pop,
      (SELECT MIN(ST_Distance(d.geom, o.geom)) FROM outlet o WHERE o.franchisor_id = ${franchisorId}::uuid) AS nearest,
      (SELECT COUNT(*)::int FROM poi p WHERE p.category='competitor' AND ST_DWithin(p.geom, d.geom, 1000)) AS comp,
      ST_Y(ST_Centroid(d.geom::geometry)) AS lat, ST_X(ST_Centroid(d.geom::geometry)) AS lon
    FROM demographic_cell d WHERE d.geom IS NOT NULL`;
  const input: WhiteSpaceCell[] = cells.map((c) => ({
    psgcCode: c.psgc, barangay: c.brgy, population: c.pop,
    nearestOwnM: c.nearest != null ? Number(c.nearest) : null, competitorCount: c.comp,
    lat: c.lat != null ? Number(c.lat) : null, lon: c.lon != null ? Number(c.lon) : null,
  }));
  const gaps = rankWhiteSpace(input);
  const topScore = gaps[0]?.opportunityScore ?? null;
  const flags = gaps.length === 0 ? ['no_gaps'] : [];
  // Density/competitor Verified, gap ranking Projected → row Projected.
  await persist(runId, siteId, 'whitespace', topScore, { gaps: gaps.slice(0, 10) }, 'projected', flags);
}
