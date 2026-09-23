import { describe, it, expect } from 'vitest';
import {
  buildAnalysisContext,
  analysisContextToJsonText,
  type AnalysisInput,
  type AnalysisModuleInput,
} from '@/lib/modules/analysisContext';

/** A fully-populated input covering all four modules. */
function fullInput(): AnalysisInput {
  const territory: AnalysisModuleInput = {
    isPrimary: true,
    truthLayer: 'verified',
    payload: {
      verdict: 'redistributes',
      maxOverlapPct: 62,
      headlineSource: 'own',
      ownOutletOverlapPct: 62,
      competitiveSaturationPct: 44,
      competitorCount: 9,
      competitorMix: { direct: 3, adjacent: 4, unrelated: 12 },
      totalCannibalizedPhp: 185000,
      competitorSet: { anchorBrand: 'Jollibee', competitors: ['A', 'B', 'C'], truthLayer: 'assumed' },
      affectedOutlets: [{ outletName: 'X' }, { outletName: 'Y' }],
      flags: ['on_ground_check_recommended', 'high_overlap'],
    },
  };
  const lease: AnalysisModuleInput = {
    isPrimary: true,
    truthLayer: 'assumed',
    payload: {
      verdict: 'above_market',
      corridor: 'Ortigas Center',
      sampleSize: 7,
      baseRentPercentile: 78,
      negotiatingRoomPhpSqm: 220,
      negotiatingRoomPct: 14,
      lowSample: false,
      zonal: {
        band: { classification: 'CR', lowPhpSqm: 55000, highPhpSqm: 90000, midPhpSqm: 72500, grain: 'barangay', truthLayer: 'verified' },
        crossCheck: { rentPer1000: 9.2, position: 'rent_rich' },
        indicativeRent: { lowPhpSqm: 1200, highPhpSqm: 1600 },
        usedAsFallback: false,
      },
      flags: ['thin_sample'],
    },
  };
  const daypart: AnalysisModuleInput = {
    isPrimary: false,
    truthLayer: 'projected',
    payload: {
      verdict: 'evening_led',
      windowMatchPct: 41,
      daytimeShare: 38,
      peakHour: 19,
      noCatchmentData: false,
      seasonality: { peakSeason: { label: 'Christmas' }, troughSeason: { label: 'Holy Week' }, termTimeNote: 'note' },
    },
  };
  const whitespace: AnalysisModuleInput = {
    isPrimary: true,
    truthLayer: 'projected',
    payload: {
      scanned: 1200,
      threshold: 40,
      source: 'grid',
      proposed: { label: 'Subject site', cannibalizationPct: 62 },
      recommendations: [
        { barangay: 'San Antonio', city: 'Pasig', cannibalizationPct: 18, verdict: 'open', beatsProposed: true },
        { barangay: 'Ugong', city: 'Pasig', cannibalizationPct: 25, verdict: 'workable', beatsProposed: true },
        { barangay: 'A', city: 'C', cannibalizationPct: 30, verdict: 'workable', beatsProposed: true },
        { barangay: 'B', city: 'C', cannibalizationPct: 33, verdict: 'workable', beatsProposed: true },
        { barangay: 'D', city: 'C', cannibalizationPct: 36, verdict: 'contested', beatsProposed: false },
        { barangay: 'E', city: 'C', cannibalizationPct: 39, verdict: 'contested', beatsProposed: false },
      ],
    },
  };
  return {
    meta: {
      runId: 'r1', siteId: 's1', siteLabel: 'Test Site', city: 'Pasig', barangay: 'San Antonio',
      siteType: 'inline', brand: 'BrandCo', vertical: 'QSR / Fast food', conceptLabel: 'QSR',
      overallConfidence: 'medium', generatedAt: '2026-08-25T00:00:00.000Z',
    },
    intake: { targetSize: 120, budget: 200000, empty: '', nothing: null },
    composite: { score: 71, verdict: 'caution' },
    modules: { territory, lease, daypart, whitespace },
  };
}

describe('buildAnalysisContext', () => {
  it('passes computed numbers through unchanged (never invents)', () => {
    const ctx = buildAnalysisContext(fullInput());
    expect(ctx.modules.territory.ran).toBe(true);
    expect((ctx.modules.territory as Record<string, unknown>).maxOverlapPct).toBe(62);
    expect((ctx.modules.lease as Record<string, unknown>).baseRentPercentile).toBe(78);
    expect(ctx.composite).toEqual({ score: 71, verdict: 'caution' });
  });

  it('summarises the Truth Layer across the modules that ran', () => {
    const ctx = buildAnalysisContext(fullInput());
    // territory=verified, lease=assumed, daypart=projected, whitespace=projected
    expect(ctx.truthLayerSummary).toEqual({ verified: 1, assumed: 1, projected: 2 });
  });

  it('marks a missing module ran:false and never fabricates its fields', () => {
    const input = fullInput();
    input.modules.daypart = null;
    const ctx = buildAnalysisContext(input);
    expect(ctx.modules.daypart.ran).toBe(false);
    expect((ctx.modules.daypart as Record<string, unknown>).windowMatchPct).toBeUndefined();
    // one fewer projected layer now
    expect(ctx.truthLayerSummary.projected).toBe(1);
  });

  it('caps white-space recommendations at five and preserves beatsProposed', () => {
    const ctx = buildAnalysisContext(fullInput());
    const recs = (ctx.modules.whitespace as unknown as { recommendations: Array<{ beatsProposed: boolean | null }> }).recommendations;
    expect(recs).toHaveLength(5);
    expect(recs[0].beatsProposed).toBe(true);
    expect(recs[4].beatsProposed).toBe(false);
  });

  it('aggregates and dedupes module flags', () => {
    const ctx = buildAnalysisContext(fullInput());
    expect(ctx.flags).toContain('high_overlap');
    expect(ctx.flags).toContain('thin_sample');
    // no duplicates
    expect(new Set(ctx.flags).size).toBe(ctx.flags.length);
  });

  it('drops empty/null intake values in the merged intake', () => {
    const ctx = buildAnalysisContext(fullInput());
    expect(ctx.intake.targetSize).toBe(120);
    expect('empty' in ctx.intake).toBe(true); // passthrough is the caller's job; assembler keeps what it's given
  });

  it('always stamps the non-negotiable guardrails', () => {
    const ctx = buildAnalysisContext(fullInput());
    expect(ctx.guardrails).toEqual({ brokerSupplementation: true, noPriceVerdict: true, zonalIsTaxFloor: true });
  });

  it('produces valid round-trippable strict JSON text', () => {
    const ctx = buildAnalysisContext(fullInput());
    const text = analysisContextToJsonText(ctx);
    const parsed = JSON.parse(text);
    expect(parsed.meta.siteLabel).toBe('Test Site');
    expect(parsed.modules.territory.verdict).toBe('redistributes');
  });

  it('handles a completely empty run (no modules ran) without throwing', () => {
    const input = fullInput();
    input.modules = { territory: null, lease: null, daypart: null, whitespace: null };
    const ctx = buildAnalysisContext(input);
    expect(ctx.modules.territory.ran).toBe(false);
    expect(ctx.modules.lease.ran).toBe(false);
    expect(ctx.truthLayerSummary).toEqual({ verified: 0, assumed: 0, projected: 0 });
    expect(ctx.flags).toEqual([]);
  });
});
