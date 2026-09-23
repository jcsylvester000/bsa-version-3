/**
 * VectorShift pipeline provider — the live Analysis Report generator.
 *
 * Sends the SITE ANALYSIS SCHEMA (text) to the VectorShift pipeline's Input node and reads
 * back the Anthropic node's response from the Output node. The System Instruction + Prompt live
 * INSIDE the VectorShift pipeline, so this file only ships the schema and returns the text + cost.
 *
 * Server-only: the API key (Bearer JWT) never reaches the browser. Every call is a brand-new
 * VectorShift run (its own run_id), so concurrent submissions from different users are fully
 * independent — there is no shared or reused run state.
 *
 * Config (env):
 *   VECTORSHIFT_API_KEY     — Bearer token (required)
 *   VECTORSHIFT_PIPELINE_ID — pipeline id, e.g. 6a8e89b52ac88a5957edcb26 (required)
 *   VECTORSHIFT_INPUT_KEY   — Input node variable name (default: BSA_v3_analsysis_page_intake)
 *   VECTORSHIFT_OUTPUT_KEY  — Output node name (default: Bsav3_Ai_analysis)
 *   VECTORSHIFT_TIMEOUT_MS  — per-call timeout (default: 24000 — keep under the host function limit)
 */
import 'server-only';

export interface VectorShiftResult {
  /** The analysis text shown to the operator (from the Output node). */
  text: string;
  /** Raw cost string from the pipeline output (kept server-side, never sent to the client). */
  cost: string | null;
  /** VectorShift's run_id for this run (for the usage/cost log). */
  vsRunId: string | null;
}

const DEFAULT_INPUT_KEY = 'BSA_v3_analsysis_page_intake';
const DEFAULT_OUTPUT_KEY = 'Bsav3_Ai_analysis';
/** Must stay under the hosting function limit (Netlify sync functions: 26s max, see
 *  app/api/analysis-report/route.ts). Override with VECTORSHIFT_TIMEOUT_MS. */
const DEFAULT_TIMEOUT_MS = 24_000;

/**
 * A generation failure with a short machine `code` (logged to pipeline_usage) and a
 * detail string for SERVER LOGS ONLY. Never forward `detail` to the client — it can contain
 * the provider's raw response body.
 */
export class AiGenerationError extends Error {
  constructor(public code: string, public detail: string) {
    super(`AI generation failed (${code})`);
    this.name = 'AiGenerationError';
  }
}

/** Run the VectorShift pipeline for one schema. Throws AiGenerationError on any failure. */
export async function generateViaVectorShift(schemaText: string): Promise<VectorShiftResult> {
  const apiKey = process.env.VECTORSHIFT_API_KEY;
  const pipelineId = process.env.VECTORSHIFT_PIPELINE_ID;
  if (!apiKey) throw new AiGenerationError('config_missing_key', 'VECTORSHIFT_API_KEY is not set.');
  if (!pipelineId) throw new AiGenerationError('config_missing_pipeline', 'VECTORSHIFT_PIPELINE_ID is not set.');

  const inputKey = process.env.VECTORSHIFT_INPUT_KEY || DEFAULT_INPUT_KEY;
  const outputKey = process.env.VECTORSHIFT_OUTPUT_KEY || DEFAULT_OUTPUT_KEY;
  const envTimeout = Number(process.env.VECTORSHIFT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TIMEOUT_MS;
  const url = `https://api.vectorshift.ai/v1/pipeline/${encodeURIComponent(pipelineId)}/run`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // A string input goes as JSON. (If this pipeline requires multipart/form-data instead,
    // switch to: const fd = new FormData(); fd.append('inputs', JSON.stringify({ [inputKey]: schemaText }));
    // body: fd, and DROP the Content-Type header so fetch sets the multipart boundary.)
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ inputs: { [inputKey]: schemaText } }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AiGenerationError(`http_${res.status}`, `VectorShift HTTP ${res.status}: ${body.slice(0, 400)}`);
    }

    const data = (await res.json().catch(() => null)) as {
      status?: string;
      run_id?: string;
      outputs?: Record<string, unknown> | null;
    } | null;
    if (!data) throw new AiGenerationError('bad_json', 'VectorShift returned a non-JSON body.');

    const outputs = data.outputs ?? {};
    const text = normalizeOutput(outputs[outputKey]);
    if (!text) {
      throw new AiGenerationError('empty_output', `No "${outputKey}" text (keys: ${Object.keys(outputs).join(', ') || 'none'}).`);
    }
    const cost = outputs.cost != null ? String(outputs.cost) : null;
    return { text, cost, vsRunId: data.run_id ?? null };
  } catch (e) {
    if (e instanceof AiGenerationError) throw e;
    if (e instanceof Error && e.name === 'AbortError') {
      throw new AiGenerationError('timeout', `VectorShift run timed out after ${timeoutMs}ms.`);
    }
    throw new AiGenerationError('network', e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}

/** An output field may come back as a plain string or wrapped — coerce to trimmed text. */
function normalizeOutput(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const inner = o.text ?? o.value ?? o.output ?? o.response;
    if (typeof inner === 'string') return inner.trim();
  }
  return String(v).trim();
}

/** Parse a numeric cost from the raw cost string (e.g. "$0.0123" → 0.0123). Null if none. */
export function parseCostValue(cost: string | null): number | null {
  if (!cost) return null;
  const m = cost.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}
