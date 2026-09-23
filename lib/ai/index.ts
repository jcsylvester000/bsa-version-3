/**
 * Provider selector for the short grounded phrasing calls (generateGrounded — Territory /
 * Lease verdict lines). AI_PROVIDER values:
 *   stub        → deterministic StubProvider (default, no key)
 *   vectorshift → the live VectorShift pipeline serves ONLY the Analysis Report
 *                 (lib/ai/analysisReport.ts); these short phrasing calls stay on the stub.
 * Any other value is a configuration error and fails loudly — it must never silently
 * degrade to the stub (a mistyped provider would otherwise ship echoed placeholder text).
 */
import 'server-only';
import type { AiProvider } from './provider';
import { StubProvider } from './stubProvider';

export const SUPPORTED_AI_PROVIDERS = ['stub', 'vectorshift'] as const;
export type AiProviderName = (typeof SUPPORTED_AI_PROVIDERS)[number];

/** The configured provider name, validated. Throws on an unsupported value. */
export function aiProviderName(): AiProviderName {
  const which = (process.env.AI_PROVIDER ?? 'stub').trim() || 'stub';
  if ((SUPPORTED_AI_PROVIDERS as readonly string[]).includes(which)) return which as AiProviderName;
  throw new Error(`AI_PROVIDER="${which}" is not supported. Use one of: ${SUPPORTED_AI_PROVIDERS.join(', ')}.`);
}

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  aiProviderName(); // validate — throws on a typo
  cached = new StubProvider();
  return cached;
}

export type { AiProvider } from './provider';
