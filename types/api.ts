/**
 * Shared API contract types. The UI consumes these; route handlers produce them.
 * Truth Layer is part of the contract — it is present on every data-bearing payload.
 */
import type { TruthLayer, Confidence } from '@/lib/truth/truthLayer';

/** Consistent success/error envelope across the whole API. */
export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export interface ApiError {
  code: string;
  message: string;
  /** Field-level validation issues, when applicable. */
  details?: Array<{ path: string; message: string }>;
}

/** A number that carries its classification wherever it travels. */
export interface ClassifiedValue<T = number> {
  value: T;
  truthLayer: TruthLayer;
  /** Optional basis note, e.g. "n=12 comps" or "modelled". */
  basis?: string;
}

export type { TruthLayer, Confidence };
