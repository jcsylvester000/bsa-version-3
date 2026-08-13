/**
 * AI provider interface. The app depends on THIS, never on a concrete SDK, so a
 * real provider (Anthropic, etc.) drops in behind the same shape with no change
 * to the retrieve-then-generate harness. Server-only; no key ever reaches the client.
 */
import 'server-only';

export interface GenerateParams {
  system: string;
  /** The ONLY context the model may use — already retrieved and classified. */
  context: string;
  /** The specific phrasing task (e.g. "write the Territory Guard verdict"). */
  task: string;
}

export interface GenerateResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  readonly name: string;
  generate(params: GenerateParams): Promise<GenerateResult>;
  /** Deterministic-ish embedding for doc_chunk. Real providers call an embed API. */
  embed(text: string): Promise<number[]>;
}
