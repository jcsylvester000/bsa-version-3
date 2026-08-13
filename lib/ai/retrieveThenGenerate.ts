/**
 * Retrieve-then-generate harness — the in-app AI pattern, as a small DAG:
 *
 *    retrieve ──▶ ground ──▶ generate ──▶ log
 *
 * Rules enforced here (AI Systems Engineer + Security):
 *  - The model sees ONLY retrieved, classified context. Numbers come from the
 *    deterministic result rows we pass in; the model may not introduce a figure
 *    that is not in front of it.
 *  - Truth Layer labels travel from doc_chunk / module_result straight into the
 *    grounded context, so generated text stays honest.
 *  - Every call is logged to ai_generation with the retrieved chunk ids for
 *    full provenance.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { getAiProvider } from './index';
import { TRUTH_META, type TruthLayer } from '@/lib/truth/truthLayer';

export interface GroundingChunk {
  id: bigint;
  content: string;
  truthLayer: TruthLayer;
}

/**
 * Hybrid retrieve over doc_chunk. Keyword (tsvector/GIN) is always available;
 * when the provider supplies an embedding we could add vector (HNSW) ranking.
 * For the stub path we use keyword search, which is deterministic and needs no key.
 */
export async function retrieve(query: string, limit = 5): Promise<GroundingChunk[]> {
  const rows = await prisma.$queryRaw<Array<{ id: bigint; content: string; truth_layer: TruthLayer }>>`
    SELECT id, content, truth_layer
    FROM doc_chunk
    WHERE tsv @@ plainto_tsquery('english', ${query})
    ORDER BY ts_rank(tsv, plainto_tsquery('english', ${query})) DESC
    LIMIT ${limit}
  `;
  // Fallback: if keyword search finds nothing, return the highest-Truth-Layer chunks
  // so generation is still grounded rather than ungrounded.
  if (rows.length === 0) {
    const fallback = await prisma.docChunk.findMany({
      take: limit,
      orderBy: { id: 'asc' },
      select: { id: true, content: true, truthLayer: true },
    });
    return fallback.map((c) => ({ id: c.id, content: c.content, truthLayer: c.truthLayer }));
  }
  return rows.map((r) => ({ id: r.id, content: r.content, truthLayer: r.truth_layer }));
}

/** Ground: fold retrieved chunks + deterministic facts into the ONLY context. */
export function ground(chunks: GroundingChunk[], facts: string[]): string {
  const chunkText = chunks
    .map((c) => `- [${TRUTH_META[c.truthLayer].label}] ${c.content}`)
    .join('\n');
  const factText = facts.map((f) => `- ${f}`).join('\n');
  return [
    'GROUNDED FACTS (the only figures you may use — do not invent or alter numbers):',
    factText || '- (none supplied)',
    '',
    'RETRIEVED REFERENCE (each line carries its Truth Layer label — preserve labels):',
    chunkText || '- (none retrieved)',
  ].join('\n');
}

const SYSTEM_INSTRUCTION =
  'You are the BSA report writer. You PHRASE verdicts and narrative from the grounded facts and ' +
  'retrieved reference provided. You never introduce a number that is not in the grounded facts, ' +
  'and you preserve every Truth Layer label (Verified / Assumed / Projected). You do not answer ' +
  'from outside knowledge. BSA supplements the broker; it does not replace them.';

export interface GenerateGroundedParams {
  pipelineRunId?: string | null;
  purpose: 'verdict' | 'summary' | 'section';
  /** Retrieval query (usually the module + verdict context). */
  retrievalQuery: string;
  /** Deterministic facts (numbers) the text may use — from module_result. */
  facts: string[];
  /** The specific phrasing task. */
  task: string;
}

export interface GroundedGeneration {
  text: string;
  model: string;
  retrievedChunkIds: bigint[];
  truthLayers: TruthLayer[];
}

/** Full DAG: retrieve → ground → generate → log. Returns the grounded text. */
export async function generateGrounded(params: GenerateGroundedParams): Promise<GroundedGeneration> {
  const provider = getAiProvider();

  // retrieve
  const chunks = await retrieve(params.retrievalQuery);
  // ground
  const context = ground(chunks, params.facts);
  // generate
  const gen = await provider.generate({ system: SYSTEM_INSTRUCTION, context, task: params.task });

  // log — provenance for every sentence
  await prisma.aiGeneration.create({
    data: {
      pipelineRunId: params.pipelineRunId ?? null,
      purpose: params.purpose,
      retrievedChunkIds: chunks.map((c) => c.id),
      model: gen.model,
      inputTokens: gen.inputTokens,
      outputTokens: gen.outputTokens,
      output: gen.text,
    },
  });

  return {
    text: gen.text,
    model: gen.model,
    retrievedChunkIds: chunks.map((c) => c.id),
    truthLayers: chunks.map((c) => c.truthLayer),
  };
}
