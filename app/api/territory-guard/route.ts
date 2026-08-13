import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun, canRunPipeline } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { territoryGuardRequestSchema } from '@/lib/validation/schemas';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { runTerritoryGuard, persistTerritoryResult, type TerritoryGuardResult } from '@/lib/modules/territoryGuard';
import { generateGrounded } from '@/lib/ai/retrieveThenGenerate';
import { audit } from '@/lib/audit/audit';
import { isMockAuth } from '@/lib/auth/mockUsers';
import { mockTerritoryGuard, DEMO_RUN_ID } from '@/lib/mock/mockCompute';

/**
 * POST /api/territory-guard — run Territory Guard for every candidate site in a run.
 * Deterministic compute writes module_result; the AI layer only phrases the verdict.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!canRunPipeline(session)) return errors.forbidden();

  const body = await req.json().catch(() => null);
  const parsed = territoryGuardRequestSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  // Mock mode: compute against in-memory demo data, no database.
  if (isMockAuth() && parsed.data.runId === DEMO_RUN_ID) {
    const radius = parsed.data.exclusivityRadiusM ?? 1500;
    return ok(await mockTerritoryGuard(radius));
  }

  const run = await prisma.pipelineRun.findUnique({
    where: { id: parsed.data.runId },
    include: {
      sites: { select: { id: true } },
      franchisor: { select: { brandName: true, subCategory: true } },
      intake: { select: { sectionA: true } },
    },
  });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  const radius = parsed.data.exclusivityRadiusM ?? run.exclusivityRadiusM;
  const conceptText = [
    run.franchisor?.brandName,
    run.franchisor?.subCategory,
    (run.intake?.sectionA as { brand?: string; concept?: string } | null)?.concept,
  ].filter(Boolean).join(' ');

  const results: Array<
    TerritoryGuardResult & {
      site: { id: string; label: string };
      candidateLat: number;
      candidateLon: number;
      verdictText: string;
      realCompetitors: Array<{ name: string; lat: number; lon: number }>;
      mapCompetitors: Array<{ name: string; lat: number; lon: number }>;
    }
  > = [];
  for (const s of run.sites) {
    const result = await runTerritoryGuard(s.id, run.franchisorId, radius, run.vertical, conceptText, run.franchisor?.brandName ?? undefined);
    await persistTerritoryResult(run.id, result);

    // Retrieve-then-generate: phrase the verdict from grounded, classified facts only.
    const site = await prisma.candidateSite.findUniqueOrThrow({
      where: { id: s.id },
      select: { id: true, label: true, lat: true, lon: true },
    });
    const facts = [
      `Candidate: ${site.label}.`,
      `Highest single-outlet trade-area overlap: ${result.maxOverlapPct}% (Verified — measured from coordinates).`,
      `Mean overlap across ${result.affectedOutlets.length} affected outlet(s): ${result.meanOverlapPct}% (Verified).`,
      `Estimated total monthly cannibalization: PHP ${result.totalCannibalizedPhp.toLocaleString()} (Projected — modelled, not measured).`,
      `Deterministic verdict from the overlap measurement: ${result.verdict}.`,
    ];
    const gen = await generateGrounded({
      pipelineRunId: run.id,
      purpose: 'verdict',
      retrievalQuery: 'territory guard cannibalization overlap verdict exclusivity radius',
      facts,
      task: `Write a two-sentence Territory Guard verdict for "${site.label}".`,
    });

    // Real competing establishments now come from runTerritoryGuard (persisted into
    // the module_result), so the map/competition read matches the pipeline path.
    results.push({
      ...result,
      site: { id: site.id, label: site.label },
      candidateLat: site.lat,
      candidateLon: site.lon,
      verdictText: gen.text,
      realCompetitors: result.realCompetitors,
    });
  }

  await audit({
    actorId: session.id,
    action: 'run_territory_guard',
    entity: 'pipeline_run',
    entityId: run.id,
    meta: { radius, sites: run.sites.length },
  });

  return ok({ runId: run.id, exclusivityRadiusM: radius, results });
}

/**
 * GET /api/territory-guard?runId=... — read stored Territory Guard results for the
 * dashboard. Access-scoped to the run's franchisor.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const runId = req.nextUrl.searchParams.get('runId');
  if (!runId) return fail({ code: 'bad_request', message: 'runId is required.' }, 400);
  if (!isUuid(runId)) return errors.notFound('Run'); // guard: non-UUID → 404, not a DB 500

  const run = await prisma.pipelineRun.findUnique({ where: { id: runId } });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  const results = await prisma.moduleResult.findMany({
    where: { pipelineRunId: runId, module: 'territory' },
    include: { site: { select: { id: true, label: true, lat: true, lon: true, city: true } } },
  });

  return ok({
    runId,
    exclusivityRadiusM: run.exclusivityRadiusM,
    results: results.map((r) => ({
      site: r.site,
      score: r.score,
      truthLayer: r.truthLayer,
      flags: r.flags,
      payload: r.payload,
    })),
  });
}
