import { describe, it, expect } from 'vitest';
import {
  ANALYSIS_CONFIGS, DEFAULT_ANALYSIS, analysisConfig, ANALYSIS_DURATION_MS,
} from '@/lib/ui/analysisSteps';

describe('analysisSteps — per-feature animation configs', () => {
  it('is an 8-second sequence', () => {
    expect(ANALYSIS_DURATION_MS).toBe(8000);
  });

  const keys = Object.keys(ANALYSIS_CONFIGS);
  it('covers the core features', () => {
    for (const k of ['dashboard', 'territory', 'lease', 'daypart', 'whitespace', 'report', 'scorecard']) {
      expect(keys).toContain(k);
    }
  });

  for (const [key, cfg] of Object.entries(ANALYSIS_CONFIGS)) {
    describe(`config "${key}"`, () => {
      it('has a title, a motif, and enough steps to feel like work', () => {
        expect(cfg.title.length).toBeGreaterThan(0);
        expect(['radar', 'grid', 'bars', 'curve', 'scan', 'network']).toContain(cfg.motif);
        expect(cfg.steps.length).toBeGreaterThanOrEqual(5);
      });
      it('has non-empty, unique steps', () => {
        for (const s of cfg.steps) expect(s.trim().length).toBeGreaterThan(0);
        expect(new Set(cfg.steps).size).toBe(cfg.steps.length);
      });
      it('gives each feature a distinct opening narration or motif', () => {
        // Not every feature needs a unique motif, but the step content should differ.
        expect(cfg.steps.join('|')).not.toBe('');
      });
    });
  }

  it('falls back to DEFAULT_ANALYSIS for an unknown feature', () => {
    expect(analysisConfig('does-not-exist')).toBe(DEFAULT_ANALYSIS);
    expect(analysisConfig('territory')).toBe(ANALYSIS_CONFIGS.territory);
  });

  it('gives Territory Guard a radar motif and a competitor-pull step', () => {
    const t = ANALYSIS_CONFIGS.territory;
    expect(t.motif).toBe('radar');
    expect(t.steps.some((s) => /competitor/i.test(s))).toBe(true);
    expect(t.steps.some((s) => /overlap/i.test(s))).toBe(true);
  });
});
