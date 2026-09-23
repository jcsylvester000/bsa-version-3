/**
 * Batch 4 — Truth Layer honesty + Grid guardrails: no price verdicts, no fabricated zeros,
 * per-field truth carried into the AI schema, and the AI output check.
 */
import { describe, it, expect } from 'vitest';
import { checkAnalysisOutput, numbersIn } from '@/lib/ai/outputCheck';
import { buildAnalysisContext, analysisSchemaText, type AnalysisInput } from '@/lib/modules/analysisContext';
import { composeMockAnalysis } from '@/lib/ai/mockAnalysis';
import { leasePositionLabel, LEASE_POSITION_LABEL, PRICE_VERDICT_PATTERNS, BROKER_DISCLAIMER_LONG } from '@/lib/truth/guardrailCopy';

function input(over: Partial<AnalysisInput['modules']> = {}): AnalysisInput {
  return {
    meta: {
      runId: 'r', siteId: 's', siteLabel: 'Kapitolyo Corner', city: 'Pasig', barangay: 'Kapitolyo', siteType: 'inline',
      brand: 'Test Brand', vertical: 'Café', conceptLabel: 'Café', overallConfidence: 'med', generatedAt: '2026-09-23T00:00:00Z',
    },
    intake: {},
    composite: { score: 58.4, verdict: 'caution' },
    modules: {
      territory: {
        isPrimary: true, truthLayer: 'projected',
        payload: {
          verdict: 'mixed', maxOverlapPct: 22, ownOutletOverlapPct: 22, competitiveSaturationPct: 18,
          competitorMix: { direct: 2, adjacent: 3, unrelated: 9 }, totalCannibalizedPhp: 41000,
          affectedOutlets: [{ outletName: 'X' }],
          truth: { overlapPct: 'assumed', competitiveSaturation: 'projected', cannibalizedPhp: 'projected' },
        },
      },
      lease: {
        isPrimary: true, truthLayer: 'assumed',
        payload: {
          verdict: 'above_market', corridor: 'Ortigas', sampleSize: 6, baseRentPercentile: 78,
          negotiatingRoomPhpSqm: 220, negotiatingRoomPct: 14, truth: { comps: 'assumed', fairRange: 'assumed', zonalBand: 'verified' },
          zonal: { band: { classification: 'CR', lowPhpSqm: 55000, highPhpSqm: 90000, truthLayer: 'verified' } },
        },
      },
      daypart: { isPrimary: true, truthLayer: 'projected', payload: { windowMatchPct: 64, daytimeShare: 58, noCatchmentData: false } },
      whitespace: { isPrimary: true, truthLayer: 'projected', payload: { scanned: 180, threshold: 40, recommendations: [] } },
      ...over,
    },
  };
}

describe('no price verdicts', () => {
  it('lease labels are positional, never judgemental', () => {
    for (const label of Object.values(LEASE_POSITION_LABEL)) {
      for (const re of PRICE_VERDICT_PATTERNS) expect(label).not.toMatch(re);
      expect(label.toLowerCase()).not.toContain('favourable');
    }
    expect(leasePositionLabel('above_market')).toBe('Above corridor median');
  });

  it('the schema the AI reads carries no price-verdict wording', () => {
    const text = analysisSchemaText(buildAnalysisContext(input()));
    expect(text).toContain('Above corridor median');
    expect(text).not.toMatch(/overpaying/i);
    expect(text).toMatch(/tax-reference floor/);
    expect(text).toMatch(/RA 9646/);
  });

  it('the disclaimer names RA 9646 and the zonal floor', () => {
    expect(BROKER_DISCLAIMER_LONG).toMatch(/Republic Act No\. 9646/);
    expect(BROKER_DISCLAIMER_LONG).toMatch(/tax-reference floors/);
  });
});

describe('Truth Layer honesty in the AI schema', () => {
  it('uses the payload per-field truth, not hard-coded Verified', () => {
    const text = analysisSchemaText(buildAnalysisContext(input()));
    expect(text).toMatch(/Own-branch overlap: 22% \(Assumed\)/);
    expect(text).toMatch(/Comparable leases: 6 \(Assumed\)/);
  });

  it('missing values print "—", never a fabricated 0', () => {
    const text = analysisSchemaText(buildAnalysisContext(input({
      territory: { isPrimary: true, truthLayer: 'projected', payload: { verdict: 'adds' } },
    })));
    expect(text).toMatch(/Own-branch overlap: — /);
    expect(text).toMatch(/Est\. monthly cannibalization: — /);
    expect(text).not.toMatch(/Own-branch overlap: 0%/);
  });

  it('flags a proxy corridor', () => {
    const text = analysisSchemaText(buildAnalysisContext(input({
      lease: { isPrimary: true, truthLayer: 'projected', payload: { verdict: 'corridor_benchmark', corridor: 'Quezon City', sampleSize: 5, flags: ['corridor_default_fallback'] } },
    })));
    expect(text).toMatch(/Corridor: Quezon City — proxy/);
  });
});

describe('AI output check', () => {
  const schema = '- Own-branch overlap: 22% (Assumed)\n- Est. monthly cannibalization: PHP 41,000 (Projected)\n- Base-rent percentile: 78th percentile\n- Composite: caution (score 58.4)';

  it('passes text whose numbers all come from the data (incl. rounding)', () => {
    const out = 'Overlap is 22% and cannibalization about ₱41,000 a month. Rent sits at the 78th percentile; composite 58.';
    expect(checkAnalysisOutput(out, [schema]).ok).toBe(true);
  });

  it('catches an invented figure', () => {
    const r = checkAnalysisOutput('Expect roughly ₱250,000 in monthly sales and 35% margins.', [schema]);
    expect(r.ok).toBe(false);
    expect(r.ungroundedNumbers).toEqual(expect.arrayContaining(['₱250,000', '35%']));
  });

  it('ignores small counts and years', () => {
    expect(checkAnalysisOutput('Two of 4 modules ran in 2026; top 3 areas.', [schema]).ok).toBe(true);
  });

  it('catches price-verdict wording', () => {
    const r = checkAnalysisOutput('At the 78th percentile the tenant is overpaying — not a good deal.', [schema]);
    expect(r.priceVerdictPhrases.length).toBeGreaterThanOrEqual(2);
    expect(r.ok).toBe(false);
  });

  it('the built-in mock write-up passes its own check', () => {
    const ctx = buildAnalysisContext(input());
    const schemaText = analysisSchemaText(ctx);
    const r = checkAnalysisOutput(composeMockAnalysis(ctx), [schemaText]);
    expect(r.priceVerdictPhrases).toEqual([]);
    expect(r.ungroundedNumbers).toEqual([]);
  });

  it('numbersIn reads peso, percent and thousands separators', () => {
    expect(numbersIn(['PHP 12,500 and 57.3% and ₱900'])).toEqual([12500, 57.3, 900]);
  });
});
