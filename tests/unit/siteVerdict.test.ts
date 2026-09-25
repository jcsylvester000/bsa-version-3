/**
 * Deterministic site recommendation (replaces the AI write-up): PROCEED / CAUTIOUS / NO-GO.
 */
import { describe, it, expect } from 'vitest';
import { summariseSite } from '@/lib/modules/siteVerdict';
import { scorecardBand } from '@/lib/modules/scorecard';

const allPrimary = () => true;

describe('summariseSite', () => {
  it('PROCEED when the drivers are positive with real coverage', () => {
    const s = summariseSite({
      territory: { verdict: 'adds', totalCannibalizedPhp: 0 },
      lease: { verdict: 'below_market', corridor: 'BGC' },
      daypart: { windowMatchPct: 72 },
    }, allPrimary);
    expect(s.classification).toBe('proceed');
    expect(s.label).toBe('Proceed');
    expect(s.tone).toBe('go');
    expect(s.headline.toLowerCase()).toContain('proceed');
    expect(s.keywords).toContain('below-market');
  });

  it('NO-GO when a PRIMARY module reads no-go (territory redistributes)', () => {
    const s = summariseSite({
      territory: { verdict: 'redistributes', totalCannibalizedPhp: 120000 },
      lease: { verdict: 'below_market' },
      daypart: { windowMatchPct: 80 },
    }, allPrimary);
    expect(s.classification).toBe('no_go');
    expect(s.tone).toBe('nogo');
    // the finding carries the data behind it
    expect(s.findings.find((f) => f.keyword === 'Cannibalization')?.detail).toMatch(/120,000/);
  });

  it('a non-primary no-go does NOT force NO-GO (stays cautious)', () => {
    const isPrimary = (k: string) => k === 'lease'; // only lease is decision-critical here
    const s = summariseSite({
      territory: { verdict: 'redistributes' }, // no-go but NOT primary
      lease: { verdict: 'at_market' },
      daypart: { windowMatchPct: 55 },
    }, isPrimary);
    expect(s.classification).toBe('cautious');
  });

  it('CAUTIOUS on mixed signals', () => {
    const s = summariseSite({
      territory: { verdict: 'mixed' },
      lease: { verdict: 'above_market' },
      daypart: { windowMatchPct: 50 },
    }, allPrimary);
    expect(s.classification).toBe('cautious');
    expect(s.label).toBe('Proceed with caution');
  });

  it('CAUTIOUS with a clear headline when there is no module data', () => {
    const s = summariseSite({}, allPrimary);
    expect(s.classification).toBe('cautious');
    expect(s.coverage).toBe(0);
    expect(s.headline.toLowerCase()).toContain('not enough');
  });

  it('white-space is informational only (does not change the call)', () => {
    const base = { territory: { verdict: 'adds' as const }, lease: { verdict: 'below_market' as const }, daypart: { windowMatchPct: 70 } };
    const withWs = summariseSite({ ...base, whitespace: { recommendations: [{ verdict: 'open' }, { verdict: 'contested' }] } }, allPrimary);
    expect(withWs.classification).toBe('proceed');
    expect(withWs.findings.find((f) => f.keyword === 'White-space')?.tone).toBe('muted');
  });
});

describe('summariseSite — the scorecard band is the single source of truth (audit F-07)', () => {
  // Modules all positive, but the composite band must still decide the call.
  const strongModules = { territory: { verdict: 'adds' as const }, lease: { verdict: 'below_market' as const }, daypart: { windowMatchPct: 90 } };
  it('band go → Proceed', () => {
    expect(summariseSite(strongModules, allPrimary, 'go').classification).toBe('proceed');
  });
  it('band caution → Cautious even when every module is positive', () => {
    const s = summariseSite(strongModules, allPrimary, 'caution');
    expect(s.classification).toBe('cautious');
    expect(s.label).toBe('Proceed with caution');
  });
  it('band nogo → No-Go even when modules look fine', () => {
    expect(summariseSite(strongModules, allPrimary, 'nogo').classification).toBe('no_go');
  });
  it('band insufficient → Cautious', () => {
    expect(summariseSite(strongModules, allPrimary, 'insufficient').classification).toBe('cautious');
  });
  it('the Final Report call always matches the dashboard band across the score range', () => {
    const want = { go: 'proceed', caution: 'cautious', nogo: 'no_go', insufficient: 'cautious' } as const;
    for (const composite of [null, 0, 30, 44.9, 45, 55, 64.9, 65, 80, 100]) {
      const band = scorecardBand(composite);
      const rec = summariseSite(strongModules, allPrimary, band).classification;
      expect(rec).toBe(want[band]);
    }
  });
});
