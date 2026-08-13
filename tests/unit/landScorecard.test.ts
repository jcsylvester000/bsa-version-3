import { describe, it, expect } from 'vitest';
import { scoreLandTraffic } from '@/lib/modules/landTrafficMath';
import { scorecardComposite, scorecardBand, scorecardTruth, buildScorecard, siteCompositeFromModules, type ScorecardCriterion } from '@/lib/modules/scorecard';

describe('scoreLandTraffic', () => {
  const mins = { minFrontageM: 30, minLotSqm: 800 };
  it('passes a high-traffic, well-sized, zoned parcel', () => {
    const r = scoreLandTraffic({ trafficBand: 'very_high', frontageM: 40, lotAreaSqm: 1000, zoningOk: true, ...mins });
    expect(r.verdict).toBe('screen_pass');
  });
  it('fails hard when zoning fails, regardless of traffic', () => {
    const r = scoreLandTraffic({ trafficBand: 'very_high', frontageM: 50, lotAreaSqm: 2000, zoningOk: false, ...mins });
    expect(r.verdict).toBe('screen_fail');
    expect(r.flags).toContain('zoning_fails');
    expect(r.composite).toBeLessThanOrEqual(25);
  });
  it('flags traffic as assumed when unknown', () => {
    const r = scoreLandTraffic({ trafficBand: 'unknown', frontageM: null, lotAreaSqm: null, zoningOk: null, ...mins });
    expect(r.flags).toContain('traffic_count_assumed');
    expect(r.flags).toContain('zoning_unconfirmed');
  });
  it('flags a below-minimum frontage', () => {
    const r = scoreLandTraffic({ trafficBand: 'high', frontageM: 10, lotAreaSqm: 1000, zoningOk: true, ...mins });
    expect(r.flags).toContain('frontage_below_minimum');
  });
});

const crit = (score: number | null, weight: number, tl: 'verified' | 'assumed' | 'projected' | null = 'verified'): ScorecardCriterion => ({
  key: 'k', label: 'l', score, weight, truthLayer: tl, note: '',
});

describe('scorecard math', () => {
  it('composite is a weighted mean of scored criteria', () => {
    expect(scorecardComposite([crit(80, 0.5), crit(60, 0.5)])).toBe(70);
  });
  it('composite is null when nothing scored', () => {
    expect(scorecardComposite([crit(null, 1)])).toBeNull();
  });
  it('bands map correctly', () => {
    expect(scorecardBand(80)).toBe('go');
    expect(scorecardBand(50)).toBe('caution');
    expect(scorecardBand(20)).toBe('nogo');
    expect(scorecardBand(null)).toBe('insufficient');
  });
  it('truth rolls up to the weakest contributor', () => {
    expect(scorecardTruth([crit(80, 1, 'verified'), crit(60, 1, 'projected')])).toBe('projected');
  });
});

describe('buildScorecard', () => {
  it('inverts territory overlap into a goodness score', () => {
    // Territory overlap 75% → goodness 25.
    const sc = buildScorecard('Site A', [{ module: 'territory', score: 75, truthLayer: 'projected', note: '' }]);
    const terr = sc.criteria.find((c) => c.key === 'territory')!;
    expect(terr.score).toBe(25);
  });
  it('marks unassessed criteria and still computes from the rest', () => {
    const sc = buildScorecard('Site A', [{ module: 'site_fit', score: 83.2, truthLayer: 'verified', note: '' }]);
    expect(sc.composite).not.toBeNull();
    expect(sc.criteria.find((c) => c.key === 'lease')!.score).toBeNull();
  });
});

describe('siteCompositeFromModules — dashboard/scorecard reconciliation', () => {
  // Regression for the credibility-breaking contradiction: a strong site-fit site that
  // also heavily cannibalizes an existing branch was showing "97 GO" on the dashboard
  // (site-fit only) while the scorecard showed "55.1 CAUTION" (all modules, territory
  // weighted). The stored composite must now equal the scorecard math so both agree.
  it('drags a high site-fit score down when territory overlap is severe', () => {
    const modules = [
      { module: 'site_fit', score: 97, truthLayer: 'verified' as const, note: '' },
      { module: 'territory', score: 86.3, truthLayer: 'projected' as const, note: '' }, // overlap % → 13.7 goodness
      { module: 'lease', score: 60, truthLayer: 'assumed' as const, note: '' },
      { module: 'daypart', score: 84, truthLayer: 'projected' as const, note: '' },
    ];
    const { composite, band } = siteCompositeFromModules(modules);
    // Must NOT stay a "go" — heavy cannibalization has to be reflected in the headline.
    expect(composite!).toBeLessThan(65);
    expect(band).not.toBe('go');
    // And it must equal exactly what the scorecard computes from the same inputs.
    expect(composite).toBe(buildScorecard('X', modules).composite);
  });

  it('a clean site with no territory conflict stays a go', () => {
    const modules = [
      { module: 'site_fit', score: 88, truthLayer: 'verified' as const, note: '' },
      { module: 'territory', score: 5, truthLayer: 'projected' as const, note: '' }, // 95 goodness
      { module: 'lease', score: 70, truthLayer: 'assumed' as const, note: '' },
    ];
    const { band } = siteCompositeFromModules(modules);
    expect(band).toBe('go');
  });
});
