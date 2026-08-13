/**
 * Provider selector. AI_PROVIDER=stub (default) needs no key. A real provider is
 * added here behind the same AiProvider interface — the harness never changes.
 */
import 'server-only';
import type { AiProvider } from './provider';
import { StubProvider } from './stubProvider';

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;
  const which = process.env.AI_PROVIDER ?? 'stub';
  switch (which) {
    // case 'anthropic': cached = new AnthropicProvider(); break;  // drops in later
    case 'stub':
    default:
      cached = new StubProvider();
  }
  return cached;
}

export type { AiProvider } from './provider';
