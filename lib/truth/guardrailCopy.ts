/**
 * Guardrail copy — the ONE place broker-facing guardrail wording lives, so the UI, the
 * exported report/PDF and the AI context always say the same thing. Pure + client-safe.
 *
 * Grid guardrails (Master Instruction):
 *  - Broker supplementation: BSA sharpens the workflow; the licensed broker closes the deal.
 *  - No price verdicts: BSA positions a rent against its corridor; it never says a price is
 *    "good", "fair" or "overpaying" — that judgement is the broker's and the client's.
 *  - BIR zonal values are tax-reference floors only — never a market price or valuation.
 *  - RA 9646 (Real Estate Service Act of the Philippines): real estate brokerage, appraisal
 *    and consultancy are licensed professions; BSA output is decision support for those
 *    practitioners, not an appraisal or a price opinion.
 */

export type LeasePosition = 'below_market' | 'at_market' | 'above_market' | 'insufficient_data' | 'corridor_benchmark';

/**
 * Positional (not judgemental) labels for where an asking rent sits in its corridor.
 * Replaces "Above market — likely overpaying" / "Below market — favourable".
 */
export const LEASE_POSITION_LABEL: Record<LeasePosition, string> = {
  below_market: 'Below corridor median',
  at_market: 'Within corridor range',
  above_market: 'Above corridor median',
  insufficient_data: 'Insufficient comparable data',
  corridor_benchmark: 'Corridor benchmark (no asking rent entered)',
};

export function leasePositionLabel(v: string | null | undefined): string {
  return (v && (LEASE_POSITION_LABEL as Record<string, string>)[v]) ?? LEASE_POSITION_LABEL.insufficient_data;
}

/** One-line explainer for the rent-percentile read (tooltip / report). */
export const LEASE_POSITION_EXPLAINER =
  'The percentile shows where the asking rent sits among comparable leases in the same corridor. ' +
  'It is a negotiating reference, not a price verdict — the broker and client judge the deal.';

/** BIR zonal framing, shown wherever a zonal figure appears. */
export const ZONAL_FLOOR_NOTE =
  'BIR zonal values are tax-reference floors set for tax computation — not market prices or valuations.';

/** RA 9646 / broker-supplementation disclaimer (short — app footer, tabs). */
export const BROKER_DISCLAIMER_SHORT =
  'BSA is decision support for licensed real estate practitioners (RA 9646). It does not appraise ' +
  'property or give price opinions; the broker still advises the client and closes the deal.';

/** Longer form for exported reports / PDFs. */
export const BROKER_DISCLAIMER_LONG =
  'This analysis is decision support prepared with Business Site Analysis (BSA). It is not an ' +
  'appraisal, a price opinion, or legal, tax or financial advice. Under Republic Act No. 9646 ' +
  '(Real Estate Service Act of the Philippines), real estate brokerage, appraisal and consultancy ' +
  'are performed by licensed professionals — a licensed broker should review these findings with ' +
  'the client. BIR zonal values shown are tax-reference floors only. Every figure carries its ' +
  'Truth Layer: Verified (sourced), Assumed (reasoned estimate), Projected (modelled).';

/**
 * Phrases that amount to a price verdict. Used by the AI output check (lib/ai/outputCheck.ts);
 * kept here so the wording rule and its enforcement share one list.
 */
export const PRICE_VERDICT_PATTERNS: RegExp[] = [
  /\boverpa(y|ying|id)\b/i,
  /\bover-?priced\b/i,
  /\bunder-?priced\b/i,
  /\b(good|great|bad|fair|excellent)\s+(deal|price|value|buy)\b/i,
  /\bbargain\b/i,
  /\b(too|very)\s+(expensive|cheap)\b/i,
  /\bworth\s+(buying|paying|the\s+price)\b/i,
  /\bshould\s+(pay|offer|accept|reject)\b/i,
];
