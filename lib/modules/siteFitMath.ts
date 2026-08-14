/**
 * Site-fit scoring — pure, testable. Combines the pillars a candidate site is
 * scored on into a 0–100 composite and a Go/Caution/No-Go verdict.
 *
 * Pillars (each 0–100, weighted): catchment demand, competition headroom,
 * accessibility. Missing pillars are excluded from the weighted mean and lower the
 * result's Truth Layer honestly rather than being guessed.
 */
import type { TruthLayer } from '@/lib/truth/truthLayer';

export interface Pillar {
  key: string;
  label: string;
  score: number | null; // 0–100, null = not measurable for this run
  weight: number;
  truthLayer: TruthLayer;
}

export interface SiteFitResult {
  composite: number | null; // 0–100
  verdict: 'go' | 'caution' | 'nogo' | 'insufficient';
  pillars: Pillar[];
  truthLayer: TruthLayer;
  flags: string[];
}

/** Weighted mean over the pillars that have a score. */
export function compositeScore(pillars: Pillar[]): number | null {
  const scored = pillars.filter((p) => p.score != null && Number.isFinite(p.score));
  if (scored.length === 0) return null;
  const totalW = scored.reduce((s, p) => s + p.weight, 0) || 1;
  const weighted = scored.reduce((s, p) => s + (p.score as number) * p.weight, 0);
  return Math.round((weighted / totalW) * 10) / 10;
}

export function verdictFromComposite(composite: number | null): SiteFitResult['verdict'] {
  if (composite == null) return 'insufficient';
  if (composite >= 65) return 'go';
  if (composite >= 45) return 'caution';
  return 'nogo';
}

/**
 * The row's Truth Layer is the weakest among the pillars that actually contributed —
 * so a score built partly on Projected demand never reads as Verified.
 */
export function rollUpPillarTruth(pillars: Pillar[]): TruthLayer {
  const scored = pillars.filter((p) => p.score != null);
  if (scored.length === 0) return 'projected';
  if (scored.some((p) => p.truthLayer === 'projected')) return 'projected';
  if (scored.some((p) => p.truthLayer === 'assumed')) return 'assumed';
  return 'verified';
}

/**
 * The demand pillar is the primary driver of site fit. If it is missing (no
 * catchment/demographic data for this location), we do NOT publish a Site-Fit
 * composite at all — a score without its 50%-weight demand driver is not a true
 * site-fit read, and a bare number ("0" or a capped "44") reads as either broken or
 * falsely precise. The row degrades to 'insufficient' and the UI explains WHY
 * (demographic layer not loaded). The competition pillar is retained in `pillars` so
 * the detailed report can still surface it as a sub-metric. Load a real demographic
 * layer and Site Fit publishes a full score normally.
 */
const DEMAND_PILLAR_KEY = 'demand';

export function scoreSiteFit(pillars: Pillar[]): SiteFitResult {
  let composite = compositeScore(pillars);
  const flags: string[] = [];
  const missing = pillars.filter((p) => p.score == null).map((p) => p.key);
  if (missing.length) flags.push(`pillars_missing:${missing.join(',')}`);

  // Only guard when the demand pillar is DEFINED for this run but has no score
  // (real data-sparse case). If the pillar set doesn't model demand at all, there's
  // nothing to withhold.
  const demand = pillars.find((p) => p.key === DEMAND_PILLAR_KEY);
  const demandMissing = demand != null && demand.score == null;

  // Honest degrade: without the primary demand pillar we do not publish a headline
  // composite at all. Mark it 'insufficient' (composite null) so the UI shows '—'
  // with a reason rather than a misleading number built on secondary pillars alone.
  if (demandMissing) {
    composite = null;
    flags.push('site_fit_demand_layer_missing');
  }

  const verdict = verdictFromComposite(composite);
  let truthLayer = rollUpPillarTruth(pillars);
  // Without the primary demand read, the row can never be Verified.
  if (demandMissing && truthLayer === 'verified') truthLayer = 'assumed';

  const anyScored = pillars.some((p) => p.score != null);
  if (!anyScored) flags.push('no_pillars_scored');
  return { composite, verdict, pillars, truthLayer, flags };
}
