/**
 * Batch 3 — scoring integrity: evidence confidence (no longer always Low), lease value score
 * direction, and dashboard confidence / failure alerts.
 */
import { describe, it, expect } from 'vitest';
import {
  siteEvidenceScore, evidenceBand, runEvidenceConfidence, leaseValueScore,
  siteCompositeFromModules, EVIDENCE_HIGH, EVIDENCE_MED,
} from '@/lib/modules/scorecard';
import { buildDashboard, type ModuleResultLite } from '@/lib/modules/dashboard';
import type { TruthLayer } from '@/lib/truth/truthLayer';

const CORE = ['site_fit', 'territory', 'lease', 'daypart', 'whitespace'];
const row = (module: string, truthLayer: TruthLayer, score: number | null = 50) => ({ module, truthLayer, score });

// A typical real run: verified demand, the usual estimates for territory/daypart/whitespace,
// assumed lease comps, lease unscored (no asking rent at pipeline time).
const typical = [
  row('site_fit', 'verified', 70),
  row('territory', 'projected', 20),
  row('lease', 'assumed', null),
  row('daypart', 'projected', 60),
  row('whitespace', 'projected', null),
];

describe('evidence confidence', () => {
  it('a typical run with real demand data is Medium — not the old always-Low', () => {
    const e = siteEvidenceScore(typical, CORE);
    expect(e).toBeGreaterThanOrEqual(EVIDENCE_MED);
    expect(e).toBeLessThan(EVIDENCE_HIGH);
    expect(evidenceBand(e)).toBe('med');
  });

  it('missing demand data (Site Fit unscorable) drops to Low', () => {
    const rows = typical.map((r) => (r.module === 'site_fit' ? { ...r, score: null } : r));
    expect(evidenceBand(siteEvidenceScore(rows, CORE))).toBe('low');
  });

  it('expected modules that produced nothing count as zero evidence', () => {
    const withoutTerritory = typical.filter((r) => r.module !== 'territory');
    expect(siteEvidenceScore(withoutTerritory, CORE)).toBeLessThan(siteEvidenceScore(typical, CORE));
  });

  it('mostly Verified heavy inputs reach High', () => {
    const strong = [row('site_fit', 'verified'), row('territory', 'verified'), row('lease', 'verified'), row('daypart', 'assumed'), row('whitespace', 'projected')];
    expect(evidenceBand(siteEvidenceScore(strong, CORE))).toBe('high');
  });

  it('an on-ground-check flag lowers the band by one', () => {
    expect(evidenceBand(0.9, { onGroundCheckFlagged: true })).toBe('med');
    expect(evidenceBand(0.6, { onGroundCheckFlagged: true })).toBe('low');
  });

  it('the AI analysis row never counts as evidence', () => {
    const withAi = [...typical, row('analysis', 'projected', null)];
    expect(siteEvidenceScore(withAi, CORE)).toBe(siteEvidenceScore(typical, CORE));
  });

  it('run confidence is the band of the mean site evidence', () => {
    expect(runEvidenceConfidence([0.8, 0.8]).confidence).toBe('high');
    expect(runEvidenceConfidence([0.8, 0.3]).confidence).toBe('med');
    expect(runEvidenceConfidence([]).confidence).toBe('low');
  });
});

describe('lease value score', () => {
  it('cheaper than the corridor scores higher (was stored the wrong way round)', () => {
    expect(leaseValueScore(20)).toBe(80);
    expect(leaseValueScore(90)).toBe(10);
    expect(leaseValueScore(null)).toBeNull();
    expect(leaseValueScore(140)).toBe(0);
  });

  it('an expensive asking rent lowers the composite instead of raising it', () => {
    const base = [
      { module: 'site_fit', score: 70, truthLayer: 'verified' as TruthLayer, note: '' },
      { module: 'territory', score: 20, truthLayer: 'projected' as TruthLayer, note: '' },
    ];
    const cheap = siteCompositeFromModules([...base, { module: 'lease', score: leaseValueScore(10), truthLayer: 'assumed', note: '' }]);
    const pricey = siteCompositeFromModules([...base, { module: 'lease', score: leaseValueScore(95), truthLayer: 'assumed', note: '' }]);
    expect(cheap.composite!).toBeGreaterThan(pricey.composite!);
  });
});

describe('dashboard', () => {
  const site = { id: 's1', label: 'BGC 7th Ave', city: 'Taguig', composite: 60, verdict: 'caution' };
  const lite = (module: string, extra: Partial<ModuleResultLite> = {}): ModuleResultLite => ({
    module, score: 50, truthLayer: 'projected', flags: [], payload: {}, site, ...extra,
  });

  it("uses the run's stored confidence when present", () => {
    const d = buildDashboard([lite('territory'), lite('daypart')], { runConfidence: 'med' });
    expect(d.confidence).toBe('med');
  });

  it('raises an alert when a module failed for a site', () => {
    const failed = { ...site, pipelineError: 'whitespace: timeout | land: boom' };
    const d = buildDashboard([lite('territory', { site: failed })], { runConfidence: 'low' });
    const a = d.alerts.find((x) => x.module === 'pipeline');
    expect(a?.detail).toContain('whitespace');
    expect(a?.detail).toContain('land');
  });

  it('ignores the AI analysis row', () => {
    const d = buildDashboard([lite('territory'), lite('analysis')], { runConfidence: 'med' });
    expect(d.truthMix.projected).toBe(1);
  });
});
