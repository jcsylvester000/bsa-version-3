import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun, canRunPipeline } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { leaseBenchmarkRequestSchema } from '@/lib/validation/schemas';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { runLeaseBenchmark, persistLeaseResult } from '@/lib/modules/leaseBenchmark';
import { generateGrounded } from '@/lib/ai/retrieveThenGenerate';
import { audit } from '@/lib/audit/audit';
import { isMockAuth } from '@/lib/auth/mockUsers';
import { mockLeaseBenchmark } from '@/lib/mock/mockCompute';

/**
 * POST /api/lease-benchmark — benchmark a candidate site's asking lease terms against
 * the corridor comps. Deterministic compute writes module_result('lease'); the AI
 * layer only phrases the verdict from the grounded, classified output.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!canRunPipeline(session)) return errors.forbidden();

  const body = await req.json().catch(() => null);
  const parsed = leaseBenchmarkRequestSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  // Mock mode: compute against in-memory demo comps, no database.
  if (isMockAuth() && parsed.data.candidateSiteId.startsWith('mock-')) {
    return ok(mockLeaseBenchmark(parsed.data.candidateSiteId, parsed.data.corridor, parsed.data.format, parsed.data.siteTerms));
  }

  if (!isUuid(parsed.data.candidateSiteId)) return errors.notFound('Candidate site'); // non-UUID → 404, not a DB 500
  // Resolve the site → its run → the run's franchisor (for access scoping).
  const site = await prisma.candidateSite.findUnique({
    where: { id: parsed.data.candidateSiteId },
    include: { run: { select: { id: true, franchisorId: true, createdByUserId: true } } },
  });
  if (!site) return errors.notFound('Candidate site');
  if (!canAccessRun(session, site.run)) return errors.forbidden();

  const result = await runLeaseBenchmark({
    candidateSiteId: site.id,
    format: parsed.data.format,
    corridor: parsed.data.corridor,
    mallName: parsed.data.mallName ?? null,
    siteTerms: parsed.data.siteTerms,
  });
  await persistLeaseResult(site.run.id, result);

  // Retrieve-then-generate: phrase the verdict from grounded, classified facts only.
  const stats = result.baseRentStats;
  const facts = [
    `Candidate: ${site.label}, corridor ${result.corridor}, format ${result.format}.`,
    stats
      ? `Corridor base-rent comps (Verified): median ₱${stats.median}/sqm, range ₱${stats.min}–₱${stats.max}/sqm, n=${stats.n}.`
      : 'No corridor base-rent comps found.',
    result.baseRentPercentile != null
      ? `The site's asking base rent sits at the ${result.baseRentPercentile}th percentile of the corridor spread (Assumed — estimate from ${result.sampleSize} comps).`
      : 'Asking base rent was not provided.',
    result.negotiatingRoomPhpSqm != null
      ? `Negotiating room to the corridor median: ₱${result.negotiatingRoomPhpSqm}/sqm (${result.negotiatingRoomPct}% ${result.negotiatingRoomPhpSqm > 0 ? 'above' : 'below'} median).`
      : '',
    `Deterministic verdict: ${result.verdict}.`,
    result.lowSample ? 'Sample is thin — the fair-range read is low-confidence and flagged.' : '',
  ].filter(Boolean);

  const gen = await generateGrounded({
    pipelineRunId: site.run.id,
    purpose: 'verdict',
    retrievalQuery: 'lease benchmark corridor median base rent escalation CUSA negotiating room over under market',
    facts,
    task: `Write a two-sentence Lease Benchmark verdict for "${site.label}".`,
  });

  await audit({
    actorId: session.id,
    action: 'run_lease_benchmark',
    entity: 'candidate_site',
    entityId: site.id,
    meta: { corridor: result.corridor, format: result.format, verdict: result.verdict },
  });

  return ok({ ...result, site: { id: site.id, label: site.label }, verdictText: gen.text });
}

/**
 * GET /api/lease-benchmark?candidateSiteId=... — read the stored Lease Benchmark result.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const siteId = req.nextUrl.searchParams.get('candidateSiteId');
  if (!siteId) return fail({ code: 'bad_request', message: 'candidateSiteId is required.' }, 400);
  if (!isUuid(siteId)) return errors.notFound('Candidate site'); // non-UUID → 404, not a DB 500

  const site = await prisma.candidateSite.findUnique({
    where: { id: siteId },
    include: { run: { select: { franchisorId: true, createdByUserId: true } } },
  });
  if (!site) return errors.notFound('Candidate site');
  if (!canAccessRun(session, site.run)) return errors.forbidden();

  const row = await prisma.moduleResult.findUnique({
    where: { site_module_key: { candidateSiteId: siteId, module: 'lease' } },
  });
  if (!row) return errors.notFound('Lease benchmark result');

  return ok({ site: { id: site.id, label: site.label }, truthLayer: row.truthLayer, flags: row.flags, payload: row.payload });
}
