/**
 * Truth Layer — structural, not decorative.
 *
 * Every reference and result row in BSA carries a classification: Verified,
 * Assumed, or Projected. This module is the single place that logic lives:
 *  - the type,
 *  - how a set of classified inputs rolls up into a run-level confidence,
 *  - display metadata (label, colour token, one-line meaning).
 *
 * The AI layer imports the *same* classifications so a label never gets
 * invented or dropped between the data layer and the generated text.
 */

export type TruthLayer = 'verified' | 'assumed' | 'projected';
export type Confidence = 'high' | 'med' | 'low';

/** Ordered from strongest to weakest evidence. */
export const TRUTH_ORDER: readonly TruthLayer[] = ['verified', 'assumed', 'projected'] as const;

export interface TruthMeta {
  label: string;
  meaning: string;
  /** Tailwind token name (see tailwind.config.ts). */
  token: TruthLayer;
}

export const TRUTH_META: Record<TruthLayer, TruthMeta> = {
  verified: {
    label: 'Verified',
    meaning: 'Measured or sourced fact — e.g. an overlap % computed from coordinates.',
    token: 'verified',
  },
  assumed: {
    label: 'Assumed',
    meaning: 'An estimate with a stated basis — shown with its sample size or source.',
    token: 'assumed',
  },
  projected: {
    label: 'Projected',
    meaning: 'A modelled or forecast figure — labelled so it is never read as fact.',
    token: 'projected',
  },
};

/**
 * Roll a set of classified data points up into one honest run-level confidence.
 * The rule mirrors the architecture: confidence is driven by the Truth Layer mix.
 *   - Mostly Verified, no Projected dominance  → high
 *   - A meaningful Projected share             → low
 *   - Otherwise                                → med
 * `onGroundCheckFlagged` forces confidence down by one band (informal-competitor
 * / on-ground-check honesty flag from the Improvement Strategy).
 */
export function rollUpConfidence(
  layers: TruthLayer[],
  opts: { onGroundCheckFlagged?: boolean } = {},
): Confidence {
  if (layers.length === 0) return 'low';

  const counts = { verified: 0, assumed: 0, projected: 0 } as Record<TruthLayer, number>;
  for (const l of layers) counts[l] += 1;
  const total = layers.length;
  const verifiedShare = counts.verified / total;
  const projectedShare = counts.projected / total;

  let band: Confidence;
  if (projectedShare >= 0.34) band = 'low';
  else if (verifiedShare >= 0.6 && projectedShare < 0.2) band = 'high';
  else band = 'med';

  if (opts.onGroundCheckFlagged) band = downgrade(band);
  return band;
}

export function downgrade(c: Confidence): Confidence {
  if (c === 'high') return 'med';
  if (c === 'med') return 'low';
  return 'low';
}

export const CONFIDENCE_META: Record<Confidence, { label: string; meaning: string }> = {
  high: { label: 'High', meaning: 'Mostly Verified data — safe to act on with normal diligence.' },
  med: { label: 'Medium', meaning: 'A mix of Verified and estimated data — confirm the key assumptions.' },
  low: { label: 'Low', meaning: 'Significant Projected content or an on-ground-check flag — verify before acting.' },
};
