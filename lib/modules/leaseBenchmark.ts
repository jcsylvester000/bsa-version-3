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
import { benchmarkLease, type Comp, type SiteTerms, type LeaseBenchmarkOutput } from './leaseMath';

export type { SiteTerms, LeaseBenchmarkOutput } from './leaseMath';

export interface LeaseBenchmarkResult extends LeaseBenchmarkOutput {
  candidateSiteId: string;
  corridor: string;
  format: string;
  mallName: string | null;
  /** The comps used, so the UI can plot the distribution honestly. */
  comps: Array<{ baseRentPhpSqm: number | null; truthLayer: TruthLayer; sampleSource: string | null }>;
  truth: { comps: TruthLayer; fairRange: TruthLayer };
  moduleTruthLayer: TruthLayer;
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

  // The row is only as strong as its softest meaningful field: the fair-range
  // estimate is Assumed (or Projected-thin when the sample is low).
  const fairRange: TruthLayer = output.lowSample ? 'projected' : 'assumed';
  const moduleTruthLayer: TruthLayer = fairRange;

  return {
    ...output,
    candidateSiteId: input.candidateSiteId,
    corridor: input.corridor,
    format: input.format,
    mallName: input.mallName ?? null,
    comps: compRows.map((c) => ({
      baseRentPhpSqm: c.baseRentPhpSqm != null ? Number(c.baseRentPhpSqm) : null,
      truthLayer: c.truthLayer,
      sampleSource: c.sampleSource,
    })),
    truth: { comps: 'verified', fairRange },
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
