/**
 * Lease Benchmark — the second P1 capability. Deterministic compute only.
 *
 * Queries lease_comp for the site's format + corridor (and mall, if applicable),
 * benchmarks the site's asking terms against the comparable distribution, and
 * writes a module_result. The AI layer only phrases the verdict from this output.
 *
 * Truth Layer: the comps are Verified against source leases; the fair-range /
 * percentile read is Assumed and shown with its sample size. The module_result row
 * therefore carries `assumed` — the estimate is the weakest meaningful field.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { TruthLayer } from '@/lib/truth/truthLayer';
import {
  benchmarkLease, type Comp, type SiteTerms, type LeaseBenchmarkOutput,
  canonicalNcrCity, bandMid, zonalRentCrossCheck, indicativeRentFromZonal,
  type ZonalBand, type ZonalCrossCheck, type IndicativeRent,
} from './leaseMath';

export type { SiteTerms, LeaseBenchmarkOutput } from './leaseMath';

/** The BIR zonal-value read attached to a lease benchmark (context + cross-check + fallback). */
export interface LeaseZonalContext {
  /** Verified commercial land-value band (CR preferred, CC fallback). */
  band: ZonalBand | null;
  /** Asking rent vs the underlying land value (Projected). Null when no asking rent. */
  crossCheck: ZonalCrossCheck | null;
  /** Projected indicative monthly rent band from the zonal midpoint. */
  indicativeRent: IndicativeRent | null;
  /** True when comps were too thin to score and we anchored the read on zonal instead. */
  usedAsFallback: boolean;
}

export interface LeaseBenchmarkResult extends LeaseBenchmarkOutput {
  candidateSiteId: string;
  corridor: string;
  format: string;
  mallName: string | null;
  /** The comps used, so the UI can plot the distribution honestly. */
  comps: Array<{ baseRentPhpSqm: number | null; truthLayer: TruthLayer; sampleSource: string | null }>;
  /** BIR zonal-value context (Verified band + Projected cross-check + fallback anchor). */
  zonal: LeaseZonalContext | null;
  truth: { comps: TruthLayer; fairRange: TruthLayer; zonalBand: TruthLayer };
  moduleTruthLayer: TruthLayer;
}

/**
 * Resolve the commercial BIR-zonal band for a site: barangay grain first (most precise),
 * falling back to a city-level band (aggregated min-low / max-high across the city's rows).
 * Prefers Commercial Regular (CR); uses Commercial Condominium (CC) when CR is absent.
 * Returns null for a non-NCR / unmapped city. Verified from the BIR schedule.
 */
async function resolveZonalBand(site: { city: string | null; barangay: string | null; label: string | null }): Promise<ZonalBand | null> {
  const city = canonicalNcrCity(site.city, site.label);
  if (!city) return null;

  type Row = { classificationCode: string; lowPhpSqm: unknown; highPhpSqm: unknown; truthLayer: TruthLayer; barangay: string };
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  const pickBand = (rows: Row[], grain: 'barangay' | 'city'): ZonalBand | null => {
    for (const code of ['CR', 'CC'] as const) {
      const r = rows.filter((x) => x.classificationCode === code && (x.lowPhpSqm != null || x.highPhpSqm != null));
      if (!r.length) continue;
      const lows = r.map((x) => num(x.lowPhpSqm)).filter((n): n is number => n != null);
      const highs = r.map((x) => num(x.highPhpSqm)).filter((n): n is number => n != null);
      const low = lows.length ? Math.min(...lows) : null;
      const high = highs.length ? Math.max(...highs) : null;
      return {
        code,
        classification: code === 'CR' ? 'Commercial Regular' : 'Commercial Condominium',
        lowPhpSqm: low,
        highPhpSqm: high,
        midPhpSqm: bandMid(low, high),
        grain,
        cityMunicipality: city,
        barangay: grain === 'barangay' ? r[0].barangay : null,
        truthLayer: r.some((x) => x.truthLayer === 'verified') ? 'verified' : 'assumed',
      };
    }
    return null;
  };

  const select = { classificationCode: true, lowPhpSqm: true, highPhpSqm: true, truthLayer: true, barangay: true } as const;

  // 1) Barangay grain (most precise) when the site carries a barangay.
  const brgy = site.barangay?.trim();
  if (brgy) {
    const brows = await prisma.zonalValue.findMany({
      where: { region: 'NCR', cityMunicipality: city, barangay: { equals: brgy, mode: 'insensitive' }, classificationCode: { in: ['CR', 'CC'] } },
      select,
    });
    const b = pickBand(brows as Row[], 'barangay');
    if (b) return b;
  }
  // 2) City-level fallback.
  const crows = await prisma.zonalValue.findMany({
    where: { region: 'NCR', cityMunicipality: city, barangay: '', classificationCode: { in: ['CR', 'CC'] } },
    select,
  });
  return pickBand(crows as Row[], 'city');
}

export interface LeaseBenchmarkInput {
  candidateSiteId: string;
  format: string;
  corridor: string;
  mallName?: string | null;
  siteTerms: SiteTerms;
}

/**
 * Run Lease Benchmark for one candidate site against the corridor comps.
 * Falls back from (format+corridor+mall) → (format+corridor) so a mall-specific
 * query still benefits from corridor comps when mall comps are thin.
 */
const LEASE_COMP_SELECT = {
  baseRentPhpSqm: true,
  escalationPct: true,
  cusaPhpSqm: true,
  leaseTermYears: true,
  fitoutMonths: true,
  truthLayer: true,
  sampleSource: true,
} as const;
const MIN_COMPS = 5;

export async function runLeaseBenchmark(input: LeaseBenchmarkInput): Promise<LeaseBenchmarkResult> {
  // Prefer mall-specific comps when a mall is given, but always include the corridor.
  let compRows = await prisma.leaseComp.findMany({
    where: {
      format: input.format,
      corridor: input.corridor,
      ...(input.mallName ? { OR: [{ mallName: input.mallName }, { mallName: null }] } : {}),
    },
    select: LEASE_COMP_SELECT,
    orderBy: { observedDate: 'desc' },
  });
  // QA v6 fix: a rent benchmark is a CORRIDOR read. When the exact format has a thin
  // sample (e.g. a mall casual-dining slot in a corridor whose comps are mostly inline),
  // fall back to ALL comps in the corridor rather than falsely reporting "insufficient."
  // Corridor-level rent is a valid proxy; the format nuance is captured in the site terms.
  if (compRows.length < MIN_COMPS) {
    compRows = await prisma.leaseComp.findMany({
      where: { corridor: input.corridor },
      select: LEASE_COMP_SELECT,
      orderBy: { observedDate: 'desc' },
    });
  }

  const comps: Comp[] = compRows.map((c) => ({
    baseRentPhpSqm: c.baseRentPhpSqm != null ? Number(c.baseRentPhpSqm) : null,
    escalationPct: c.escalationPct != null ? Number(c.escalationPct) : null,
    cusaPhpSqm: c.cusaPhpSqm != null ? Number(c.cusaPhpSqm) : null,
    leaseTermYears: c.leaseTermYears ?? null,
    fitoutMonths: c.fitoutMonths ?? null,
  }));

  const output = benchmarkLease(input.siteTerms, comps);

  // --- BIR zonal-value context ------------------------------------------------
  // Resolve the site's commercial zonal band (Verified), then cross-check the asking
  // rent against the underlying land value and, when comps are too thin to score,
  // supply a Projected indicative rent band so the read is never a dead end. Never
  // overrides the comp verdict — BIR zonal is a tax-reference floor, not a price verdict.
  const site = await prisma.candidateSite.findUnique({
    where: { id: input.candidateSiteId },
    select: { city: true, barangay: true, label: true },
  });
  let zonal: LeaseZonalContext | null = null;
  let zonalBandTruth: TruthLayer = 'projected';
  if (site) {
    const band = await resolveZonalBand(site);
    if (band) {
      const crossCheck: ZonalCrossCheck | null =
        input.siteTerms.baseRentPhpSqm != null ? zonalRentCrossCheck(input.siteTerms.baseRentPhpSqm, band.midPhpSqm) : null;
      const indicativeRent: IndicativeRent = indicativeRentFromZonal(band.midPhpSqm);
      const usedAsFallback = output.verdict === 'insufficient_data' && indicativeRent.midPhpSqm != null;
      zonal = { band, crossCheck, indicativeRent, usedAsFallback };
      zonalBandTruth = band.truthLayer; // the BAND is Verified; cross-check/indicative are Projected
    }
  }

  // The row is only as strong as its softest meaningful field: the fair-range
  // estimate is Assumed (or Projected-thin when the sample is low). A zonal-anchored
  // fallback read is Projected.
  const fairRange: TruthLayer = output.lowSample ? 'projected' : 'assumed';
  const moduleTruthLayer: TruthLayer = fairRange;

  const flags = [...output.flags];
  if (zonal?.usedAsFallback) flags.push('zonal_fallback_anchor');
  if (zonal?.crossCheck?.position === 'rich') flags.push('rent_rich_vs_zonal');

  return {
    ...output,
    flags,
    candidateSiteId: input.candidateSiteId,
    corridor: input.corridor,
    format: input.format,
    mallName: input.mallName ?? null,
    comps: compRows.map((c) => ({
      baseRentPhpSqm: c.baseRentPhpSqm != null ? Number(c.baseRentPhpSqm) : null,
      truthLayer: c.truthLayer,
      sampleSource: c.sampleSource,
    })),
    zonal,
    truth: { comps: 'verified', fairRange, zonalBand: zonalBandTruth },
    moduleTruthLayer,
  };
}

/** Persist a Lease Benchmark result as a module_result row (idempotent per site×module). */
export async function persistLeaseResult(runId: string, result: LeaseBenchmarkResult): Promise<void> {
  await prisma.moduleResult.upsert({
    where: { site_module_key: { candidateSiteId: result.candidateSiteId, module: 'lease' } },
    update: {
      score: result.baseRentPercentile ?? undefined,
      payload: result as unknown as object,
      truthLayer: result.moduleTruthLayer,
      flags: result.flags,
    },
    create: {
      candidateSiteId: result.candidateSiteId,
      pipelineRunId: runId,
      module: 'lease',
      score: result.baseRentPercentile ?? undefined,
      payload: result as unknown as object,
      truthLayer: result.moduleTruthLayer,
      flags: result.flags,
    },
  });
}
