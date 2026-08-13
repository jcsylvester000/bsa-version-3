/**
 * F9 — Self-Serve Site Scorecard. A one-page, brand-standard scorecard a franchisee
 * can apply to a walk-in site themselves, generated from the run's module results.
 * Serves ~92 brands (the 2nd-most-requested capability in the PFA data).
 *
 * It rolls the deterministic module results into weighted criteria with a
 * Go / Caution / No-Go band, carrying the Truth Layer of whatever data populates it.
 * Pure logic (server module composes the inputs); testable.
 */
import type { TruthLayer } from '@/lib/truth/truthLayer';

export interface ScorecardCriterion {
  key: string;
  label: string;
  /** 0–100 score from the module, or null when not assessed. */
  score: number | null;
  weight: number;
  truthLayer: TruthLayer | null;
  note: string;
}

export interface Scorecard {
  siteLabel: string;
  criteria: ScorecardCriterion[];
  composite: number | null;
  band: 'go' | 'caution' | 'nogo' | 'insufficient';
  truthLayer: TruthLayer;
}

/** Weighted composite over criteria that have a score. */
export function scorecardComposite(criteria: ScorecardCriterion[]): number | null {
  const scored = criteria.filter((c) => c.score != null);
  if (scored.length === 0) return null;
  const totalW = scored.reduce((s, c) => s + c.weight, 0) || 1;
  return Math.round((scored.reduce((s, c) => s + (c.score as number) * c.weight, 0) / totalW) * 10) / 10;
}

export function scorecardBand(composite: number | null): Scorecard['band'] {
  if (composite == null) return 'insufficient';
  if (composite >= 65) return 'go';
  if (composite >= 45) return 'caution';
  return 'nogo';
}

/** Weakest contributing Truth Layer drives the scorecard's overall classification. */
export function scorecardTruth(criteria: ScorecardCriterion[]): TruthLayer {
  const scored = criteria.filter((c) => c.score != null && c.truthLayer);
  if (scored.length === 0) return 'projected';
  if (scored.some((c) => c.truthLayer === 'projected')) return 'projected';
  if (scored.some((c) => c.truthLayer === 'assumed')) return 'assumed';
  return 'verified';
}

/** The criteria template — which modules map to which scorecard line, and their weight. */
export const SCORECARD_TEMPLATE: Array<{ key: string; label: string; module: string; weight: number }> = [
  { key: 'site_fit', label: 'Site fit (catchment & competition)', module: 'site_fit', weight: 0.3 },
  { key: 'territory', label: 'Territory (adds vs redistributes)', module: 'territory', weight: 0.25 },
  { key: 'lease', label: 'Lease value vs corridor', module: 'lease', weight: 0.2 },
  { key: 'demand', label: 'Demand timing (daypart)', module: 'daypart', weight: 0.1 },
  { key: 'competition', label: 'Competition (incl. informal)', module: 'informal', weight: 0.1 },
  { key: 'land', label: 'Land & traffic screen', module: 'land', weight: 0.05 },
];

export interface ModuleScore {
  module: string;
  score: number | null;
  truthLayer: TruthLayer;
  note: string;
}

/**
 * Turn a site's module scores into the weighted scorecard criteria. Shared by the
 * scorecard artifact AND the orchestrator's stored-composite recompute, so the
 * dashboard headline and the scorecard are computed from the SAME math and can
 * never disagree (e.g. a heavy-cannibalization site can't read "97 GO" on the
 * dashboard while the scorecard says "55.1 CAUTION").
 */
export function scorecardCriteria(moduleScores: ModuleScore[]): ScorecardCriterion[] {
  const byModule = new Map(moduleScores.map((m) => [m.module, m]));
  return SCORECARD_TEMPLATE.map((t) => {
    const m = byModule.get(t.module);
    // Territory score is an overlap % where HIGHER is worse → invert to a 0–100 goodness.
    let score = m?.score ?? null;
    if (t.module === 'territory' && score != null) score = Math.round((100 - score) * 10) / 10;
    return {
      key: t.key, label: t.label, score, weight: t.weight,
      truthLayer: m?.truthLayer ?? null,
      note: m?.note ?? 'Not assessed for this run.',
    };
  });
}

/**
 * The site's decision-grade composite + band from ALL contributing modules — the
 * single source of truth for both the dashboard headline and the scorecard band.
 * `band` is 'insufficient' when nothing scored.
 */
export function siteCompositeFromModules(moduleScores: ModuleScore[]): {
  composite: number | null;
  band: Scorecard['band'];
} {
  const criteria = scorecardCriteria(moduleScores);
  const composite = scorecardComposite(criteria);
  return { composite, band: scorecardBand(composite) };
}

/** Build the scorecard from the run's module scores for one site. */
export function buildScorecard(siteLabel: string, moduleScores: ModuleScore[]): Scorecard {
  const criteria = scorecardCriteria(moduleScores);
  const composite = scorecardComposite(criteria);
  return {
    siteLabel,
    criteria,
    composite,
    band: scorecardBand(composite),
    truthLayer: scorecardTruth(criteria),
  };
}
