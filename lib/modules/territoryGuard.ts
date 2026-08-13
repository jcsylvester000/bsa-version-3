/**
 * Territory Guard — the #1 requested capability. Deterministic compute only.
 *
 * For a candidate site: find existing outlets whose catchment could overlap,
 * measure the trade-area overlap % against each (Verified — from coordinates),
 * estimate cannibalized vs incremental volume (Projected — modelled, labelled),
 * and produce a plain verdict: does the site ADD sales or REDISTRIBUTE them.
 *
 * The AI layer only phrases this result; it never recomputes or invents a number.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { catchmentOverlap, type LatLon } from '@/lib/geo/geo';
import type { TruthLayer } from '@/lib/truth/truthLayer';
import { catchmentRadius, cannibalizationFraction, verdictFromOverlap, competitiveSaturationPct } from './territoryMath';
import { competitorsNear } from '@/lib/places/poiCache';
import { haversineMeters } from '@/lib/geo/geo';
import {
  conceptFor, tierFor, weightedCompetitorCount, categorizeByName,
  TIER_ORDER, type RelevanceTier, type TierCounts,
} from '@/lib/places/competitorRelevance';

// Re-export the pure helpers so existing importers keep working.
export { cannibalizationFraction, catchmentRadius } from './territoryMath';

export interface OutletOverlap {
  outletId: string;
  outletName: string;
  distanceM: number;
  overlapPct: number; // Verified
  outletMonthlySalesPhp: number | null;
  /** Projected: PHP of this outlet's sales estimated to be redistributed to the candidate. */
  cannibalizedPhp: number;
}

export interface TerritoryGuardResult {
  candidateSiteId: string;
  exclusivityRadiusM: number;
  candidateCatchmentM: number;
  /**
   * HEADLINE overlap % — the stronger of own-branch trade-area overlap (Verified) and
   * competitive saturation (Projected). This is what the score/verdict read. Kept named
   * `maxOverlapPct` for backward compatibility with existing consumers.
   */
  maxOverlapPct: number;
  /** Verified: highest single OWN-outlet trade-area overlap %. 0 when the brand has no own outlets. */
  ownOutletOverlapPct: number;
  /**
   * Projected: modelled competitive saturation % from same-concept competitors in the
   * catchment (the cannibalization-map signal). This is why a NEW brand in a saturated
   * corridor no longer reads as 0% — it faces competitor cannibalization even with no own
   * branches. A market-saturation proxy, never a measured trade-area overlap.
   */
  competitiveSaturationPct: number;
  /** Count of DIRECT same-concept competitor establishments inside the candidate catchment. */
  competitorCount: number;
  /**
   * Tier mix inside the catchment — direct rivals, adjacent formats (sell into the same
   * demand but it isn't their primary business), and unrelated businesses. Lets the UI
   * say WHY the saturation reads as it does instead of a bare count.
   */
  competitorMix: TierCounts;
  /** Saturation-weighted count actually fed to the model: direct + 0.35 × adjacent. */
  weightedCompetitorCount: number;
  /** The concept the competitor set was matched against (e.g. "QSR / fast food"). */
  conceptLabel: string;
  /**
   * The named competitor brands this concept is cannibalized by, from the Cannibalization
   * Map (competitor_set). Lets the report say WHO competes, not just how many. Empty when
   * no anchor matches the brand/concept. Truth Layer carried per the map row.
   */
  competitorSet: { anchorBrand: string; competitors: string[]; truthLayer: TruthLayer } | null;
  /** Which signal set the headline: 'own' (own-branch overlap) or 'competitive' (saturation). */
  headlineSource: 'own' | 'competitive' | 'none';
  /** Verified: mean overlap across affected OWN outlets. */
  meanOverlapPct: number;
  /** Projected: total estimated monthly cannibalization across the OWN network, PHP. */
  totalCannibalizedPhp: number;
  /** verdict is derived from the HEADLINE overlap. */
  verdict: 'adds' | 'mixed' | 'redistributes';
  affectedOutlets: OutletOverlap[];
  /** DIRECT same-concept competitors near the candidate (Verified coords from the DB). */
  realCompetitors: Array<{ name: string; lat: number; lon: number }>;
  /**
   * Nearby establishments for the map, each tagged with its relevance tier and name
   * category, sorted so direct rivals come first. Unrelated businesses are still carried
   * so the map can draw them as faint context — the UI must NOT label them competitors.
   */
  mapCompetitors: Array<{ name: string; lat: number; lon: number; tier: RelevanceTier; category: string }>;
  /** Per-field Truth Layer, carried into the module_result payload and the AI context. */
  truth: {
    overlapPct: TruthLayer;            // own-outlet overlap — Verified (from coordinates)
    competitiveSaturation: TruthLayer; // competitor-set saturation — Projected (modelled)
    cannibalizedPhp: TruthLayer;
  };
  /** Row-level classification for module_result: the weakest field drives it. */
  moduleTruthLayer: TruthLayer;
  flags: string[];
}

interface OutletRow {
  id: string;
  outlet_name: string;
  format: string | null;
  lat: number;
  lon: number;
  monthly_sales_php: number | null;
  dist_m: number;
}

/**
 * RAW nearby-establishment pull from the DB, nearest first. `category = 'competitor'` in
 * the poi table only means "this is a business POI" — it carries NO concept relevance, so
 * this list mixes gyms, fuel stations and banks in with genuine rivals. Callers MUST tier
 * it (tierFor) before showing or counting anything. Coordinates come from the database.
 */
async function nearbyEstablishmentsFromDb(
  lat: number,
  lon: number,
  radiusM: number,
  max: number,
): Promise<Array<{ name: string; lat: number; lon: number }>> {
  const rows = await prisma.$queryRaw<Array<{ name: string; lat: number; lon: number }>>`
    SELECT name, lat, lon
    FROM poi
    WHERE category = 'competitor'
      AND geom IS NOT NULL
      AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, ${radiusM})
    ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) ASC
    LIMIT ${max}`;
  return rows.map((r) => ({ name: r.name, lat: r.lat, lon: r.lon }));
}

/**
 * The Master-Roster category prefix that best fits each intake vertical, so a concept-key
 * fallback prefers the RIGHT category (e.g. fnb_qsr → the C02 QSR anchors, not a C01
 * food-cart row that also carries conceptKey 'qsr'). Only the primary mappings are listed;
 * anything unmapped just skips the category-preference step.
 */
const VERTICAL_CATEGORY_PREFIX: Record<string, string> = {
  fnb_qsr: 'C02', fnb_cafe: 'C03', fnb_bakery: 'C04',
  convenience: 'C05', pharmacy: 'C06', diagnostics: 'C06',
  services_salon: 'C06', services_spa: 'C06',
  services_laundry: 'C07', education: 'C08', remittance: 'C09',
  retail_apparel: 'C11', retail_specialty: 'C11', services_fitness: 'C12',
};

/** Rank a Truth Layer for preference: Verified > Assumed > Projected. */
function truthRank(t: TruthLayer): number {
  return t === 'verified' ? 2 : t === 'assumed' ? 1 : 0;
}

type CSetRow = { anchorBrand: string; competitors: string[]; truthLayer: TruthLayer; category: string; conceptKey: string };

/**
 * Resolve the named competitor set for a brand/concept from the Cannibalization Map
 * (competitor_set). Resolution order, most specific first:
 *   1. Exact anchor-brand match  → the brand's own row (e.g. "Jollibee" → Jollibee).
 *   2. Peer match                → an anchor that lists this brand in ITS competitor set
 *                                  (the brand is a named rival of a mapped anchor).
 *   3. Concept + category        → the best row for the intake's concept key, PREFERRING
 *                                  the category that matches the vertical (so a fried-chicken
 *                                  QSR resolves to a C02 QSR anchor, not a C01 food cart) and
 *                                  a Verified row.
 * Returns null when nothing matches — the saturation COUNT still works; we just can't name
 * the specific brands.
 */
async function lookupCompetitorSet(
  vertical: string | undefined,
  brandOrConcept: string | undefined,
): Promise<{ anchorBrand: string; competitors: string[]; truthLayer: TruthLayer } | null> {
  const pick = (r: CSetRow) => ({ anchorBrand: r.anchorBrand, competitors: r.competitors, truthLayer: r.truthLayer });
  try {
    const brand = (brandOrConcept ?? '').trim();

    // 1) Exact anchor match on the brand text.
    if (brand) {
      const hit = await prisma.competitorSet.findFirst({
        where: { anchorBrand: { equals: brand, mode: 'insensitive' } },
        select: { anchorBrand: true, competitors: true, truthLayer: true, category: true, conceptKey: true },
      });
      if (hit) return pick(hit);
    }

    if (!vertical) return null;
    const key = conceptFor(vertical, brandOrConcept).key;

    // Load all rows for the resolved concept once, then rank in code.
    const rows = await prisma.competitorSet.findMany({
      where: { conceptKey: key },
      select: { anchorBrand: true, competitors: true, truthLayer: true, category: true, conceptKey: true },
    });
    if (rows.length === 0) return null;

    // 2) Peer match — an anchor whose competitor list names this brand.
    if (brand) {
      const b = brand.toLowerCase();
      const peer = rows.find((r) => r.competitors.some((c) => c.toLowerCase().includes(b) || b.includes(c.toLowerCase())));
      if (peer) return pick(peer);
    }

    // 3) Concept + category preference, then Truth Layer, then a larger competitor list.
    const prefix = VERTICAL_CATEGORY_PREFIX[vertical];
    const ranked = [...rows].sort((a, b) => {
      const catA = prefix && a.category.startsWith(prefix) ? 1 : 0;
      const catB = prefix && b.category.startsWith(prefix) ? 1 : 0;
      if (catA !== catB) return catB - catA;                       // prefer matching category
      const tr = truthRank(b.truthLayer) - truthRank(a.truthLayer);
      if (tr !== 0) return tr;                                      // prefer Verified
      return b.competitors.length - a.competitors.length;          // prefer a richer set
    });
    return pick(ranked[0]);
  } catch {
    // competitor_set not seeded / query failed — degrade gracefully.
  }
  return null;
}

/**
 * Run Territory Guard for one candidate site. Reads outlets for the site's
 * franchisor within (exclusivity radius + max catchment) using the GiST index,
 * then computes overlap deterministically in code.
 */
export async function runTerritoryGuard(
  candidateSiteId: string,
  franchisorId: string,
  exclusivityRadiusM: number,
  vertical?: string,
  brandOrConcept?: string,
  /** The operator's own brand name, so their existing branches aren't counted as rivals. */
  ownBrandName?: string,
): Promise<TerritoryGuardResult> {
  const site = await prisma.candidateSite.findUniqueOrThrow({
    where: { id: candidateSiteId },
    select: { id: true, lat: true, lon: true, siteType: true },
  });

  const candidate: LatLon = { lat: site.lat, lon: site.lon };
  const candidateCatchmentM = catchmentRadius(site.siteType);

  // Search window: any outlet whose catchment could touch the candidate's, plus
  // the exclusivity radius. Uses ST_DWithin on the geography GiST index.
  const searchM = exclusivityRadiusM + candidateCatchmentM + 1500;
  const rows = await prisma.$queryRaw<OutletRow[]>`
    SELECT o.id, o.outlet_name, o.format, o.lat, o.lon,
           o.monthly_sales_php::float8 AS monthly_sales_php,
           ST_Distance(
             o.geom,
             ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography
           ) AS dist_m
    FROM outlet o
    WHERE o.franchisor_id = ${franchisorId}::uuid
      AND o.status = 'open'
      AND ST_DWithin(
            o.geom,
            ST_SetSRID(ST_MakePoint(${site.lon}, ${site.lat}), 4326)::geography,
            ${searchM}
          )
    ORDER BY dist_m ASC
  `;

  const affected: OutletOverlap[] = [];
  for (const r of rows) {
    const outletCatchment = catchmentRadius(r.format);
    const ov = catchmentOverlap(candidate, { lat: r.lat, lon: r.lon }, candidateCatchmentM, outletCatchment);
    if (ov.overlapPct <= 0) continue;
    const frac = cannibalizationFraction(ov.overlapPct);
    const cannibalizedPhp = r.monthly_sales_php != null ? Math.round(r.monthly_sales_php * frac) : 0;
    affected.push({
      outletId: r.id,
      outletName: r.outlet_name,
      distanceM: ov.distanceM,
      overlapPct: ov.overlapPct,
      outletMonthlySalesPhp: r.monthly_sales_php,
      cannibalizedPhp,
    });
  }

  // Dedupe affected outlets by name — a brand can have the same outlet ingested more
  // than once (overlapping OSM/manual ingests, slightly different ids/coords), which
  // otherwise lists "SM Megamall 86.3%" three times and reads as sloppy in front of a
  // client. Keep the single worst-overlap instance per outlet name.
  {
    const byOutlet = new Map<string, OutletOverlap>();
    for (const a of affected) {
      const key = a.outletName.trim().toLowerCase();
      const prev = byOutlet.get(key);
      if (!prev || a.overlapPct > prev.overlapPct) byOutlet.set(key, a);
    }
    affected.length = 0;
    affected.push(...[...byOutlet.values()].sort((x, y) => y.overlapPct - x.overlapPct));
  }

  const overlaps = affected.map((a) => a.overlapPct);
  // OWN-branch trade-area overlap (Verified). 0 when the brand has no own outlets —
  // which, on its own, used to produce a false "0% / Adds sales" for new brands.
  const ownOutletOverlapPct = overlaps.length ? Math.max(...overlaps) : 0;
  const meanOverlapPct = overlaps.length
    ? Math.round((overlaps.reduce((s, x) => s + x, 0) / overlaps.length) * 10) / 10
    : 0;
  const totalCannibalizedPhp = affected.reduce((s, a) => s + a.cannibalizedPhp, 0);

  const flags: string[] = [];
  if (affected.some((a) => a.outletMonthlySalesPhp == null)) {
    flags.push('some_outlet_sales_missing');
  }

  // NEARBY ESTABLISHMENTS, TIERED BY VERTICAL RELEVANCE.
  //
  // Everything below works off ONE raw pull that is then tiered in code, so the map and
  // the saturation number can never disagree. Tiering is name-based (see tierFor), which
  // matters because DB/OSM places carry no Google primaryType — the old type-only filter
  // silently passed EVERY nearby business through for type-discriminated concepts like
  // QSR, so a gym and a fuel station counted as Jollibee competitors.
  const mapRadiusM = Math.min(exclusivityRadiusM, 2000);
  const concept = conceptFor(vertical ?? 'other', brandOrConcept);
  const candidatePoint: LatLon = { lat: site.lat, lon: site.lon };

  // Warm the shared POI cache for this area+vertical (no-op when already covered). We use
  // its side-effect only; the sets below come from the raw DB pull so one tiering rule
  // governs both the map and the counts.
  if (vertical) {
    try {
      await competitorsNear(site.lat, site.lon, vertical, brandOrConcept, { radiusM: mapRadiusM, max: 1 });
    } catch {
      /* cache warm is best-effort — the DB read below still works */
    }
  }

  // The brand's OWN branches also sit in the poi table. They are not competitors: they are
  // already drawn as outlet pins and measured separately (and more precisely) by own-branch
  // trade-area overlap. Counting them again as "direct competitors" would represent the same
  // cannibalization twice and read oddly ("Jollibee — Direct competitor") on the map.
  //
  // Match on the BRAND NAME alone — `brandOrConcept` is a joined discriminator string
  // ("Jollibee QSR and Fast Food"), so testing a POI name against the whole phrase never
  // matches. Both sides are normalized to alphanumerics so "McDonald's Morayta" still
  // resolves to "McDonald's", and the ≥4-char floor keeps a short token from over-matching.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const ownNeedle = norm(ownBrandName ?? '');
  const isOwnBrand = (name: string) => ownNeedle.length >= 4 && norm(name).includes(ownNeedle);

  const rawNearby = (await nearbyEstablishmentsFromDb(site.lat, site.lon, mapRadiusM, 250))
    .filter((p) => !isOwnBrand(p.name));
  const tiered = rawNearby.map((p) => ({
    ...p,
    tier: tierFor({ name: p.name, primaryType: null }, concept),
    category: categorizeByName(p.name).key,
    distM: haversineMeters(candidatePoint, { lat: p.lat, lon: p.lon }),
  }));

  // Same-concept ("real") competitors = DIRECT tier only. This is the set the report and
  // the AI layer may legitimately call competitors.
  const directNearby = tiered.filter((p) => p.tier === 'direct');
  const realCompetitors = directNearby.slice(0, 20).map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));
  if (realCompetitors.length) flags.push(`real_competitors_${realCompetitors.length}`);

  // COMPETITIVE SATURATION (the cannibalization-map signal). Only establishments inside
  // the candidate's OWN catchment genuinely contest its trade area. Direct rivals count in
  // full; adjacent formats (a convenience store vs a QSR) count at ADJACENT_WEIGHT because
  // they take a slice of the same spend without being a second outlet of the same concept;
  // unrelated businesses do not count at all. Projected: a market-saturation proxy,
  // labelled as such, never presented as a measured trade-area overlap.
  const inCatchment = tiered.filter((p) => p.distM <= candidateCatchmentM);
  const competitorMix: TierCounts = {
    direct: inCatchment.filter((p) => p.tier === 'direct').length,
    adjacent: inCatchment.filter((p) => p.tier === 'adjacent').length,
    unrelated: inCatchment.filter((p) => p.tier === 'unrelated').length,
  };
  const competitorCount = competitorMix.direct;
  const weighted = weightedCompetitorCount(competitorMix);
  const competitiveSaturation = competitiveSaturationPct(weighted);
  if (competitorCount > 0) flags.push(`competitor_saturation_${competitorCount}`);
  if (competitorMix.adjacent > 0) flags.push(`adjacent_formats_${competitorMix.adjacent}`);

  // Name the competitor brands this concept is cannibalized by (from the Cannibalization
  // Map), so the report can say WHO competes, not just how many establishments were found.
  const competitorSet = await lookupCompetitorSet(vertical, brandOrConcept);

  // HEADLINE = the stronger of the two signals. Own-branch overlap is Verified; competitive
  // saturation is Projected. The verdict reads whichever is more binding, so a saturated
  // corridor is flagged even for a brand-new operator.
  const maxOverlapPct = Math.max(ownOutletOverlapPct, competitiveSaturation);
  const headlineSource: 'own' | 'competitive' | 'none' =
    maxOverlapPct <= 0 ? 'none' : ownOutletOverlapPct >= competitiveSaturation ? 'own' : 'competitive';
  const verdict = verdictFromOverlap(maxOverlapPct);
  if (verdict === 'redistributes') flags.push('high_cannibalization_risk');

  // MAP POINTS — the same tiered list, ordered so DIRECT rivals come first (they draw and
  // read first), then adjacent formats, then unrelated businesses as faint context. Every
  // point carries its tier so the map can style and label it honestly; nothing here is
  // called a "competitor" unless it actually is one.
  const mapCompetitors = [...tiered]
    .sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.distM - b.distM)
    .slice(0, 80)
    .map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, tier: p.tier, category: p.category }));

  return {
    candidateSiteId,
    exclusivityRadiusM,
    candidateCatchmentM,
    maxOverlapPct,
    ownOutletOverlapPct,
    competitiveSaturationPct: competitiveSaturation,
    competitorCount,
    competitorMix,
    weightedCompetitorCount: weighted,
    conceptLabel: concept.label,
    competitorSet,
    headlineSource,
    meanOverlapPct,
    totalCannibalizedPhp,
    verdict,
    affectedOutlets: affected,
    realCompetitors,
    mapCompetitors,
    truth: {
      overlapPct: 'verified',            // own-branch overlap, from coordinates
      competitiveSaturation: 'projected', // modelled market-saturation proxy
      cannibalizedPhp: 'projected',
    },
    // The row carries the weakest field's classification so nothing reads as
    // stronger than its softest input: cannibalization PHP / saturation are Projected.
    moduleTruthLayer: 'projected',
    flags,
  };
}

/** Persist a Territory Guard result as a module_result row (idempotent per site×module). */
export async function persistTerritoryResult(
  runId: string,
  result: TerritoryGuardResult,
): Promise<void> {
  await prisma.moduleResult.upsert({
    where: { site_module_key: { candidateSiteId: result.candidateSiteId, module: 'territory' } },
    update: {
      score: result.maxOverlapPct,
      payload: result as unknown as object,
      truthLayer: result.moduleTruthLayer,
      flags: result.flags,
    },
    create: {
      candidateSiteId: result.candidateSiteId,
      pipelineRunId: runId,
      module: 'territory',
      score: result.maxOverlapPct,
      payload: result as unknown as object,
      truthLayer: result.moduleTruthLayer,
      flags: result.flags,
    },
  });
}
