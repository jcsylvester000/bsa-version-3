/**
 * Brief alignment (2026-11-04) — pins the app to "BSA Investor Brief — Scoring & Data Verification"
 * (3 Nov 2026). If a number here changes, the brief (or the approval) must change with it.
 */
import { describe, it, expect } from 'vitest';
import {
  SCORE_WEIGHTS, BAND_GO, BAND_CAUTION, bandForScore, tradeAreaRadius, TRUTH_VALUE,
  CONFIDENCE_HIGH, CONFIDENCE_MEDIUM, NOGO_CAP, CAUTION_CAP, CROWDED_SATURATION_PCT,
} from '@/lib/modules/scoringConfig';
import {
  siteCompositeFromModules, scorecardBand, siteConfidence, siteVisitReasons, evidenceBand, type ModuleScore,
} from '@/lib/modules/scorecard';
import { CORE_MODULES, modulesForVertical } from '@/lib/modules/verticalConfig';
import { territoryCall, catchmentRadius } from '@/lib/modules/territoryMath';
import { demandPillarScore, competitionPillarScore, verdictFromComposite } from '@/lib/modules/siteFitMath';
import { informalCompetitionScore } from '@/lib/modules/p2p3Math';

const ms = (module: string, score: number | null, extra: Partial<ModuleScore> = {}): ModuleScore =>
  ({ module, score, truthLayer: 'assumed', note: '', ...extra });

describe('How the score works — weights', () => {
  it('six questions weighted 30/25/20/10/10/5, summing to 100 %', () => {
    expect(SCORE_WEIGHTS).toEqual({ site_fit: 0.3, territory: 0.25, lease: 0.2, daypart: 0.1, informal: 0.1, land: 0.05 });
    expect(Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('all six checks run for EVERY business type (S-1)', () => {
    for (const m of ['site_fit', 'territory', 'lease', 'daypart', 'informal', 'land']) expect(CORE_MODULES).toContain(m);
    for (const v of ['pharmacy', 'fuel', 'retail_apparel', 'other', 'fnb_qsr'] as const) {
      const mods = modulesForVertical(v);
      for (const m of ['site_fit', 'territory', 'lease', 'daypart', 'informal', 'land']) expect(mods).toContain(m);
    }
  });

  it('a check with no data is left out and the weights rescale — never counted as zero', () => {
    // No asking rent → lease unscored. Others all 80 → composite 80 (not 80 × 0.8 = 64).
    const r = siteCompositeFromModules([
      ms('site_fit', 80), ms('territory', 20 /* overlap % → 80 goodness */, { territory: { ownOutletOverlapPct: 0, competitiveSaturationPct: 20, maxOverlapPct: 20, headlineSource: 'competitive' } }), ms('lease', null),
      ms('daypart', 80), ms('informal', 80), ms('land', 80),
    ]);
    expect(r.composite).toBe(80);
    expect(r.band).toBe('go');
  });

  it('weighted average follows the brief weights', () => {
    // site_fit 100, everything else 0 (territory overlap 100 → goodness 0) — but territory overlap ≥ 40 caps.
    // Use a clean territory (overlap 0 → 100) and check 0.30·100 + 0.25·100 / 1.0 = 55 with others 0.
    const r = siteCompositeFromModules([
      ms('site_fit', 100), ms('territory', 0), ms('lease', 0), ms('daypart', 0), ms('informal', 0), ms('land', 0),
    ]);
    expect(r.uncapped).toBe(55);
  });
});

describe('Score bands', () => {
  it('65+ Proceed · 45–64 Caution · below 45 No-Go', () => {
    expect([BAND_GO, BAND_CAUTION]).toEqual([65, 45]);
    expect(bandForScore(65)).toBe('go');
    expect(bandForScore(64.9)).toBe('caution');
    expect(bandForScore(45)).toBe('caution');
    expect(bandForScore(44.9)).toBe('nogo');
    expect(scorecardBand(65)).toBe('go');
    expect(scorecardBand(44.9)).toBe('nogo');
    expect(verdictFromComposite(66)).toBe('go'); // Site Fit uses the same bands
  });
});

describe('Override rules', () => {
  it('own-branch overlap ≥ 40 % → No-Go regardless of the average', () => {
    const r = siteCompositeFromModules([
      ms('site_fit', 100), ms('territory', 40, { territory: { ownOutletOverlapPct: 40, competitiveSaturationPct: 0, maxOverlapPct: 40 } }),
      ms('lease', 100), ms('daypart', 100), ms('informal', 100), ms('land', 100),
    ]);
    expect(r.composite).toBe(NOGO_CAP);
    expect(r.band).toBe('nogo');
  });
  it('39.9 % own overlap is not the deal-breaker', () => {
    expect(territoryCall({ ownOutletOverlapPct: 39.9, competitiveSaturationPct: 0 }).verdict).toBe('mixed');
    expect(territoryCall({ ownOutletOverlapPct: 40, competitiveSaturationPct: 0 }).verdict).toBe('redistributes');
  });
  it('a very crowded area (≥ 40 % saturation) caps at Caution, never No-Go', () => {
    expect(CROWDED_SATURATION_PCT).toBe(40);
    const r = siteCompositeFromModules([
      ms('site_fit', 100), ms('territory', 85, { territory: { ownOutletOverlapPct: 0, competitiveSaturationPct: 85, maxOverlapPct: 85, headlineSource: 'competitive' } }),
      ms('lease', 100), ms('daypart', 100), ms('informal', 100), ms('land', 100),
    ]);
    expect(r.band).toBe('caution');
    expect(r.composite).toBeLessThanOrEqual(CAUTION_CAP);
  });
  it('no population data (Site Fit unscored) tops out at Caution', () => {
    const r = siteCompositeFromModules([ms('site_fit', null), ms('territory', 0), ms('lease', 100), ms('daypart', 100), ms('informal', 100), ms('land', 100)]);
    expect(r.composite).toBe(CAUTION_CAP);
    expect(r.band).toBe('caution');
  });
});

describe('Trade area by store format (S-4)', () => {
  it('600 m kiosk · 900 m inline · 1.2 km mall · 1 km other', () => {
    expect(tradeAreaRadius('kiosk')).toBe(600);
    expect(tradeAreaRadius('inline')).toBe(900);
    expect(tradeAreaRadius('mall')).toBe(1200);
    expect(tradeAreaRadius('freestanding')).toBe(1000);
    expect(tradeAreaRadius(null)).toBe(1000);
    expect(catchmentRadius('kiosk')).toBe(600); // Territory Guard reads the same table
  });
  it('Site Fit thresholds scale with the circle area (density-fair)', () => {
    // At the 1,200 m reference the calibration is unchanged: 21,000 people → 50.
    expect(demandPillarScore(21000, 1200)).toBe(50);
    // A 600 m kiosk circle has 1/4 the area → the same density (5,250 people) also scores 50.
    expect(demandPillarScore(5250, 600)).toBe(50);
    // Competition: 12 competitors at the 800 m reference → 0 headroom; 6 → 50.
    expect(competitionPillarScore(12, 800)).toBe(0);
    expect(competitionPillarScore(6, 800)).toBe(50);
    expect(competitionPillarScore(0, 600)).toBe(100);
    expect(informalCompetitionScore(12, 800)).toBe(50);
    expect(informalCompetitionScore(0, 1200)).toBe(100);
  });
});

describe('Confidence', () => {
  it('Verified 1.00 · Assumed 0.70 · Projected 0.35; High ≥ 0.75, Medium ≥ 0.50', () => {
    expect(TRUTH_VALUE).toEqual({ verified: 1, assumed: 0.7, projected: 0.35 });
    expect([CONFIDENCE_HIGH, CONFIDENCE_MEDIUM]).toEqual([0.75, 0.5]);
    expect(evidenceBand(0.75)).toBe('high');
    expect(evidenceBand(0.749)).toBe('med');
    expect(evidenceBand(0.5)).toBe('med');
    expect(evidenceBand(0.499)).toBe('low');
  });
  it('drops one level only when an on-site visit is advised (S-2)', () => {
    const rows = [
      { module: 'site_fit', score: 70, truthLayer: 'verified' as const },
      { module: 'territory', score: 10, truthLayer: 'verified' as const },
      { module: 'lease', score: 50, truthLayer: 'verified' as const },
      { module: 'informal', score: 60, truthLayer: 'assumed' as const, flags: [] },
    ];
    const expected = ['site_fit', 'territory', 'lease', 'informal'];
    // An informal result by itself no longer lowers confidence.
    expect(siteConfidence(rows, expected).confidence).toBe('high');
    expect(siteConfidence(rows, expected).visitReasons).toEqual([]);
    const flagged = rows.map((r) => (r.module === 'informal' ? { ...r, flags: ['on_ground_check_advised'] } : r));
    const c = siteConfidence(flagged, expected);
    expect(c.confidence).toBe('med');
    expect(c.visitReasons).toEqual(['on_ground_check_advised']);
  });
  it('a failed check or an unmapped area advises a visit', () => {
    expect(siteVisitReasons([{ module: 'informal', flags: ['low_poi_coverage'] }])).toEqual(['low_poi_coverage']);
    expect(siteVisitReasons([], 'land: timeout')).toEqual(['check_failed']);
    expect(siteVisitReasons([{ module: 'lease', flags: ['lease_comps_stale'] }])).toEqual([]);
  });
});
