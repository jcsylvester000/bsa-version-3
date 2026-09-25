/**
 * Analysis Report generator — the retrieve-then-generate capstone.
 *
 *   assemble strict JSON (deterministic) ─▶ retrieve interpretation knowledge ─▶
 *   generate (system + JSON-as-context + task) ─▶ log provenance ─▶ persist per-site
 *
 * The model sees ONLY the strict JSON (already-computed figures, each Truth-Layer tagged)
 * plus the retrieved interpretation reference. It never recomputes; it phrases.
 *
 * Runtime shape (Batch 2): ONE site per request, never fanned out inside another request —
 * each call must finish inside a single serverless invocation. The per-site module_result
 * row doubles as a lock so concurrent requests can't double-bill the live provider.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { ModuleKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { aiProviderName } from './index';
import { isReadyPayload, isFreshLock, versionToken, type AnalysisPayload } from './analysisCache';
import { checkAnalysisOutput, type OutputCheck } from './outputCheck';
import { retrieve } from './retrieveThenGenerate';
import { TRUTH_META } from '@/lib/truth/truthLayer';
import { rollUpConfidence, type TruthLayer, type Confidence } from '@/lib/truth/truthLayer';
import { isPrimaryModule } from '@/lib/modules/verticalConfig';
import { buildAnalysisContext, analysisContextToJsonText, analysisSchemaText, type AnalysisInput, type AnalysisModuleInput } from '@/lib/modules/analysisContext';
import { humanizeVertical } from '@/lib/modules/verticalConfig';
import { conceptFor } from '@/lib/places/competitorRelevance';
import { composeMockAnalysis } from './mockAnalysis';
import { generateViaVectorShift, parseCostValue, AiGenerationError } from './vectorshiftProvider';

export interface AnalysisReportResult {
  analysis: string;
  /** The labeled text schema the model read (mirrors the on-screen page). */
  schemaText: string;
  contextJson: unknown;
  model: string;
  confidence: Confidence;
  generatedAt: string;
  cached: boolean;
  /** Post-generation guardrail check (numbers traceable to the data; no price-verdict wording).
   *  null on reports generated before the check existed. */
  check: OutputCheck | null;
}

/** Merge the submitted intake sections the operator actually filled (skip null/empty). */
function mergeIntake(sections: Array<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of sections) {
    if (s && typeof s === 'object') {
      for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
        if (v !== null && v !== undefined && v !== '') out[k] = v;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------
// Cache states + concurrency
//
// The per-site `analysis` module_result row is BOTH the cache and a lock:
//   payload.status = 'ready'      → a finished report (legacy rows without status but with an
//                                    `analysis` string are treated as ready)
//   payload.status = 'generating' → a generation is in flight (lockId + startedAt)
// A generation first CLAIMS the row (create, or a conditional update on the previous
// token), so two simultaneous requests for the same site can never both call — and both
// pay for — the live model. A claim older than LOCK_TTL_MS is considered abandoned (e.g. the
// function was killed) and can be taken over.
// ---------------------------------------------------------------------------------------

/** Max user-forced regenerations per site per rolling 24h (live provider only — cost cap). */
export const REGENERATE_CAP_PER_DAY = 3;

type Payload = AnalysisPayload;

export type AnalysisState =
  | { state: 'ready'; result: AnalysisReportResult }
  | { state: 'generating'; startedAt: string }
  | { state: 'missing' };

export type GenerateOutcome =
  | { status: 'ready'; result: AnalysisReportResult }
  | { status: 'generating'; startedAt: string }
  | { status: 'regenerate_limit'; cap: number };

function toResult(p: Payload & { analysis: string }, cached: boolean): AnalysisReportResult {
  return {
    analysis: p.analysis,
    schemaText: (p.schemaText as string) ?? '',
    contextJson: p.contextJson ?? null,
    model: (p.model as string) ?? 'mock-analysis-v1',
    confidence: (p.confidence as Confidence) ?? 'med',
    generatedAt: (p.generatedAt as string) ?? new Date().toISOString(),
    cached,
    check: (p.check as OutputCheck | undefined) ?? null,
  };
}

async function readRow(siteId: string) {
  return prisma.moduleResult.findUnique({
    where: { site_module_key: { candidateSiteId: siteId, module: 'analysis' as ModuleKind } },
    select: { id: true, payload: true },
  });
}

/** Read-only: the cached state for a site. Never generates (safe for GET routes / PDF). */
export async function readAnalysis(siteId: string): Promise<AnalysisState> {
  const row = await readRow(siteId);
  const p = (row?.payload ?? null) as Payload | null;
  if (isReadyPayload(p)) return { state: 'ready', result: toResult(p, true) };
  if (isFreshLock(p)) return { state: 'generating', startedAt: String(p!.startedAt) };
  return { state: 'missing' };
}

/**
 * True when an error means the database schema is behind the code (needs migrate/seed), across
 * both the typed client and raw SQL:
 *  - P2021 (table does not exist) / P2022 (column does not exist) — typed Prisma client.
 *  - P2010 (raw query failed) wrapping Postgres 42P01 (undefined_table) / 42703 (undefined_column),
 *    which is how a missing/unseeded doc_chunk surfaces through the retrieval $queryRaw.
 * Recognising these turns a confusing 502 "internal" into a 503 with an actionable message.
 */
function isMissingSchemaError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (code === 'P2021' || code === 'P2022') return true;
  const meta = (err as { meta?: { code?: unknown } })?.meta;
  const pgCode = String(meta?.code ?? '');
  if (code === 'P2010' && (pgCode === '42P01' || pgCode === '42703')) return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /(does not exist|undefined_table|undefined_column|42P01|42703)/i.test(msg);
}

/**
 * Generate (or return the cached) Analysis Report for one site in a run.
 * `force` regenerates (capped per site per day on the live provider).
 * Throws AiGenerationError (code + server-only detail) when the provider fails.
 */
export async function generateAnalysisReport(
  runId: string,
  siteId: string,
  opts: { force?: boolean; actorId?: string } = {},
): Promise<GenerateOutcome> {
  const which = aiProviderName(); // throws on an unsupported AI_PROVIDER
  const row = await readRow(siteId);
  const prev = (row?.payload ?? null) as Payload | null;

  if (isReadyPayload(prev) && !opts.force) return { status: 'ready', result: toResult(prev, true) };
  if (isFreshLock(prev)) return { status: 'generating', startedAt: String(prev!.startedAt) };

  // Cost cap on user-forced regeneration (live provider only; the stub is free).
  if (opts.force && isReadyPayload(prev) && which === 'vectorshift') {
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    // Fails OPEN (logged) if the usage table can't be read — e.g. a pending migration —
    // so a monitoring problem never blocks a broker's analysis.
    const n = await prisma.pipelineUsage
      .count({ where: { candidateSiteId: siteId, trigger: 'regenerate', createdAt: { gte: since } } })
      .catch((e) => { console.error('[analysis] regenerate-cap count failed (migration pending?)', e); return 0; });
    if (n >= REGENERATE_CAP_PER_DAY) return { status: 'regenerate_limit', cap: REGENERATE_CAP_PER_DAY };
  }

  // --- Claim the lock -------------------------------------------------------------
  const lockId = randomUUID();
  const startedAt = new Date().toISOString();
  const restore: Payload | null = isReadyPayload(prev) ? { ...prev, status: 'ready' } : null;
  const lockPayload = { ...(restore ?? {}), status: 'generating', lockId, startedAt };
  if (!row) {
    try {
      await prisma.moduleResult.create({
        data: { candidateSiteId: siteId, pipelineRunId: runId, module: 'analysis' as ModuleKind, payload: lockPayload as object, truthLayer: 'projected', flags: [] },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'P2002') return { status: 'generating', startedAt }; // someone else claimed it first
      throw e;
    }
  } else {
    const token = prev ? versionToken(prev) : null;
    const claimed = await prisma.moduleResult.updateMany({
      where: { id: row.id, ...(token ? { payload: token } : {}) },
      data: { payload: lockPayload as object },
    });
    if (claimed.count === 0) return { status: 'generating', startedAt }; // lost the race
  }

  // --- Generate (lock held) --------------------------------------------------------
  const trigger: 'initial' | 'regenerate' = opts.force && restore ? 'regenerate' : 'initial';
  const t0 = Date.now();
  try {
    const result = await generateLocked(runId, siteId, which, { actorId: opts.actorId, trigger }, lockId);
    return { status: 'ready', result };
  } catch (err) {
    const code = err instanceof AiGenerationError ? err.code
      // A database that is behind the code → tell the operator to migrate/seed, not "internal".
      // P2021 (table) / P2022 (column) come from the typed client; P2010 wraps a raw-SQL error
      // whose Postgres code is 42P01 (undefined_table) / 42703 (undefined_column) — e.g. a missing
      // or unseeded doc_chunk hit by the retrieval query. Match both shapes.
      : isMissingSchemaError(err) ? 'db_migration_pending'
      : 'internal';
    const detail = err instanceof AiGenerationError ? err.detail : err instanceof Error ? err.message : String(err);
    console.error(`[analysis] generation failed run=${runId} site=${siteId} code=${code}: ${detail}`);
    if (which === 'vectorshift') {
      // Failed calls are logged too — a timed-out run may still be billed.
      await prisma.pipelineUsage.create({
        data: {
          userId: opts.actorId ?? null, pipelineRunId: runId, candidateSiteId: siteId,
          provider: 'vectorshift', model: 'vectorshift', status: 'error', errorCode: code,
          latencyMs: Date.now() - t0, trigger,
        },
      }).catch((e) => console.error('[analysis] usage log failed (migration pending?)', e));
    }
    // Release the lock: put the previous report back, or remove the placeholder.
    const mine = { path: ['lockId'], equals: lockId };
    if (restore) {
      await prisma.moduleResult.updateMany({ where: { candidateSiteId: siteId, module: 'analysis' as ModuleKind, payload: mine }, data: { payload: restore as object } });
    } else {
      await prisma.moduleResult.deleteMany({ where: { candidateSiteId: siteId, module: 'analysis' as ModuleKind, payload: mine } });
    }
    throw err instanceof AiGenerationError ? err : new AiGenerationError(code, detail);
  }
}

/** The retrieve-then-generate body. Runs only while this request holds the site's lock. */
async function generateLocked(
  runId: string,
  siteId: string,
  which: 'stub' | 'vectorshift',
  opts: { actorId?: string; trigger: 'initial' | 'regenerate' },
  lockId: string,
): Promise<AnalysisReportResult> {
  const run = await prisma.pipelineRun.findUniqueOrThrow({
    where: { id: runId },
    include: {
      franchisor: { select: { brandName: true, subCategory: true } },
      intake: { select: { sectionA: true, sectionB: true, sectionC: true, sectionD: true, sectionE: true, sectionF: true, sectionH: true, sectionI: true, sectionJ: true } },
    },
  });
  const site = await prisma.candidateSite.findUniqueOrThrow({
    where: { id: siteId },
    select: { id: true, label: true, city: true, barangay: true, siteType: true, compositeScore: true, verdict: true },
  });
  const rows = await prisma.moduleResult.findMany({
    where: { candidateSiteId: siteId, module: { in: ['territory', 'lease', 'daypart', 'whitespace'] } },
    select: { module: true, payload: true, truthLayer: true },
  });
  const byModule = new Map(rows.map((r) => [r.module, r]));
  const mod = (k: 'territory' | 'lease' | 'daypart' | 'whitespace'): AnalysisModuleInput | null => {
    const r = byModule.get(k);
    if (!r) return null;
    return {
      payload: (r.payload as Record<string, unknown>) ?? null,
      isPrimary: isPrimaryModule(run.vertical, k),
      truthLayer: r.truthLayer as TruthLayer,
    };
  };

  const layers = rows.map((r) => r.truthLayer as TruthLayer);
  const onGround = rows.some((r) => (r.payload as { flags?: string[] } | null)?.flags?.some((f) => f.includes('on_ground')) ?? false);
  // Use the RUN's evidence confidence (set by the pipeline) so the write-up, dashboard and
  // PDF all show the same label; fall back to the local roll-up only for legacy runs.
  const confidence: Confidence = (run.confidence as Confidence | null) ?? rollUpConfidence(layers, { onGroundCheckFlagged: onGround });

  const conceptText = [run.franchisor?.brandName, run.franchisor?.subCategory].filter(Boolean).join(' ');
  const input: AnalysisInput = {
    meta: {
      runId, siteId,
      siteLabel: site.label,
      city: site.city,
      barangay: site.barangay,
      siteType: site.siteType,
      brand: run.franchisor?.brandName ?? null,
      vertical: humanizeVertical(run.vertical),
      conceptLabel: conceptFor(run.vertical, conceptText).label,
      overallConfidence: confidence,
      generatedAt: new Date().toISOString(),
    },
    intake: mergeIntake([
      run.intake?.sectionA, run.intake?.sectionB, run.intake?.sectionC, run.intake?.sectionD,
      run.intake?.sectionE, run.intake?.sectionF, run.intake?.sectionH, run.intake?.sectionI, run.intake?.sectionJ,
    ]),
    composite: { score: site.compositeScore != null ? Number(site.compositeScore) : null, verdict: (site.verdict as string | null) ?? null },
    modules: { territory: mod('territory'), lease: mod('lease'), daypart: mod('daypart'), whitespace: mod('whitespace') },
  };

  const ctx = buildAnalysisContext(input);
  // The schema text the model reads — a labeled serialization that mirrors the page 1:1.
  const schemaText = analysisSchemaText(ctx);
  // JSON kept too, for the collapsible "data the AI read" and provenance.
  const jsonText = analysisContextToJsonText(ctx);

  // Retrieve interpretation reference (how to read each field), grounded with Truth Layer.
  const chunks = await retrieve(`site analysis interpretation ${input.meta.conceptLabel} territory lease daypart white-space zonal cannibalization`, 6);
  const chunkText = chunks.map((c) => `- [${TRUTH_META[c.truthLayer].label}] ${c.content}`).join('\n');

  const context = [
    'SITE ANALYSIS SCHEMA — the ONLY figures you may use; do not invent or alter any number:',
    schemaText,
    '',
    'INTERPRETATION REFERENCE — how to read the fields above (each line carries its Truth Layer; preserve the labels):',
    chunkText || '- (none retrieved)',
  ].join('\n');

  // Which generator (validated by aiProviderName):
  //  - 'vectorshift' → live VectorShift pipeline (prompts live in the pipeline; we ship the schema
  //                   + interpretation reference as one labelled text input).
  //  - 'stub' (default) → deterministic mock narrative from the same context.
  let narrative: string;
  let model: string;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const t0 = Date.now();

  if (which === 'vectorshift') {
    // Send the schema AND the retrieved interpretation reference (was schema only — the
    // retrieve step's output was discarded on the live path). VECTORSHIFT_SEND_REFERENCE=0
    // reverts to schema-only if the pipeline prompt needs it.
    const sendReference = process.env.VECTORSHIFT_SEND_REFERENCE !== '0';
    const vs = await generateViaVectorShift(sendReference ? context : schemaText);
    narrative = vs.text;
    model = 'vectorshift';
    // Usage/cost log ONLY (admin monitor) — no response text stored here. NON-FATAL: VectorShift
    // has already run (and billed) at this point, so a logging failure (e.g. a pending
    // migration) must never throw away the finished write-up.
    await prisma.pipelineUsage.create({
      data: {
        userId: opts.actorId ?? null,
        franchisorId: run.franchisorId ?? null,
        pipelineRunId: runId,
        candidateSiteId: siteId,
        provider: 'vectorshift',
        model,
        vsRunId: vs.vsRunId,
        costRaw: vs.cost,
        costValue: parseCostValue(vs.cost),
        status: 'ok',
        latencyMs: Date.now() - t0,
        trigger: opts.trigger,
      },
    }).catch((e) => console.error('[analysis] usage log write failed (migration pending?)', e));
  } else {
    narrative = composeMockAnalysis(ctx);
    model = 'mock-analysis-v1';
    inputTokens = Math.ceil((context.length + jsonText.length) / 4);
    outputTokens = Math.ceil(narrative.length / 4);
    // Dev/provenance log for the mock path.
    await prisma.aiGeneration.create({
      data: {
        pipelineRunId: runId,
        purpose: 'summary',
        retrievedChunkIds: chunks.map((c) => c.id),
        model,
        inputTokens,
        outputTokens,
        output: narrative,
      },
    });
  }

  const generatedAt = new Date().toISOString();

  // Guardrail check: every number must trace to what the model was given; no price verdicts.
  const check = checkAnalysisOutput(narrative, [schemaText, chunkText]);
  if (!check.ok) {
    console.warn(`[analysis] guardrail check run=${runId} site=${siteId}`, check);
  }

  // Persist the finished report — only if we still hold the lock (a stale-lock takeover by
  // another request wins; we then just return our text without overwriting theirs).
  const payload = {
    status: 'ready', analysis: narrative, schemaText, contextJson: ctx, model, confidence, generatedAt, check,
    // Provenance for every path (the VectorShift path previously logged no chunk ids).
    retrievedChunkIds: chunks.map((c) => String(c.id)),
  };
  await prisma.moduleResult.updateMany({
    where: { candidateSiteId: siteId, module: 'analysis' as ModuleKind, payload: { path: ['lockId'], equals: lockId } },
    data: { payload: payload as object, truthLayer: 'projected', flags: check.ok ? [] : ['ai_output_check_failed'] },
  });

  return { analysis: narrative, schemaText, contextJson: ctx, model, confidence, generatedAt, cached: false, check };
}
