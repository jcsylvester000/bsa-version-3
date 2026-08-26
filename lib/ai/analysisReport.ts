/**
 * Analysis Report generator — the retrieve-then-generate capstone.
 *
 *   assemble strict JSON (deterministic) ─▶ retrieve interpretation knowledge ─▶
 *   generate (system + JSON-as-context + task) ─▶ log provenance ─▶ persist per-site
 *
 * The model sees ONLY the strict JSON (already-computed figures, each Truth-Layer tagged)
 * plus the retrieved interpretation reference. It never recomputes; it phrases. Runs on the
 * stub provider today; swap AI_PROVIDER for a live model and this file is unchanged.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { ModuleKind } from '@prisma/client';
import { getAiProvider } from './index';
import { retrieve } from './retrieveThenGenerate';
import { TRUTH_META } from '@/lib/truth/truthLayer';
import { rollUpConfidence, type TruthLayer, type Confidence } from '@/lib/truth/truthLayer';
import { isPrimaryModule } from '@/lib/modules/verticalConfig';
import { buildAnalysisContext, analysisContextToJsonText, analysisSchemaText, type AnalysisInput, type AnalysisModuleInput } from '@/lib/modules/analysisContext';
import { humanizeVertical } from '@/lib/modules/verticalConfig';
import { conceptFor } from '@/lib/places/competitorRelevance';
import { composeMockAnalysis } from './mockAnalysis';

export interface AnalysisReportResult {
  analysis: string;
  /** The labeled text schema the model read (mirrors the on-screen page). */
  schemaText: string;
  contextJson: unknown;
  model: string;
  confidence: Confidence;
  generatedAt: string;
  cached: boolean;
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

/**
 * Generate (or return the cached) Analysis Report for one site in a run.
 * `force` regenerates and overwrites the cached module_result.
 */
export async function generateAnalysisReport(
  runId: string,
  siteId: string,
  opts: { force?: boolean } = {},
): Promise<AnalysisReportResult> {
  // Cache: a persisted `analysis` module_result for this site.
  if (!opts.force) {
    const cached = await prisma.moduleResult.findUnique({
      where: { site_module_key: { candidateSiteId: siteId, module: 'analysis' as ModuleKind } },
      select: { payload: true },
    });
    const p = cached?.payload as Record<string, unknown> | undefined;
    if (p && typeof p.analysis === 'string') {
      return {
        analysis: p.analysis as string,
        schemaText: (p.schemaText as string) ?? '',
        contextJson: p.contextJson ?? null,
        model: (p.model as string) ?? 'mock-analysis-v1',
        confidence: (p.confidence as Confidence) ?? 'med',
        generatedAt: (p.generatedAt as string) ?? new Date().toISOString(),
        cached: true,
      };
    }
  }

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
  const confidence = rollUpConfidence(layers, { onGroundCheckFlagged: onGround });

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

  // Mock path (AI_PROVIDER=stub, the default) composes the narrative deterministically from the
  // same context; the real model drops in behind the same schema + prompts when configured.
  const useMock = (process.env.AI_PROVIDER ?? 'stub') === 'stub';
  let narrative: string;
  let model: string;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  if (useMock) {
    narrative = composeMockAnalysis(ctx);
    model = 'mock-analysis-v1';
    inputTokens = Math.ceil((context.length + jsonText.length) / 4);
    outputTokens = Math.ceil(narrative.length / 4);
  } else {
    const { ANALYSIS_SYSTEM_PROMPT, ANALYSIS_TASK_INSTRUCTIONS } = await import('./analysisPrompts');
    const provider = getAiProvider();
    const gen = await provider.generate({ system: ANALYSIS_SYSTEM_PROMPT, context, task: ANALYSIS_TASK_INSTRUCTIONS });
    narrative = gen.text;
    model = gen.model;
    inputTokens = gen.inputTokens;
    outputTokens = gen.outputTokens;
  }

  const generatedAt = new Date().toISOString();

  // Provenance log.
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

  // Persist the analysis per-site (the cache + what the tab reads).
  const payload = { analysis: narrative, schemaText, contextJson: ctx, model, confidence, generatedAt };
  await prisma.moduleResult.upsert({
    where: { site_module_key: { candidateSiteId: siteId, module: 'analysis' as ModuleKind } },
    update: { payload: payload as object, truthLayer: 'projected', flags: [] },
    create: { candidateSiteId: siteId, pipelineRunId: runId, module: 'analysis' as ModuleKind, payload: payload as object, truthLayer: 'projected', flags: [] },
  });

  return { analysis: narrative, schemaText, contextJson: ctx, model, confidence, generatedAt, cached: false };
}
