import { describe, it, expect } from 'vitest';
import { compositeScore, verdictFromComposite, rollUpPillarTruth, scoreSiteFit, type Pillar } from '@/lib/modules/siteFitMath';
import { modulesForVertical, CORE_MODULES } from '@/lib/modules/verticalConfig';
import { inferCorridor } from '@/lib/modules/orchestrator';

const P = (score: number | null, weight: number, tl: 'verified' | 'assumed' | 'projected' = 'verified'): Pillar => ({
  key: 'k', label: 'l', score, weight, truthLayer: tl,
});

describe('compositeScore', () => {
  it('is null when no pillar has a score', () => {
    expect(compositeScore([P(null, 1), P(null, 1)])).toBeNull();
  });
  it('is a weighted mean of the scored pillars', () => {
    // (80*0.5 + 60*0.5) / 1 = 70
    expect(compositeScore([P(80, 0.5), P(60, 0.5)])).toBe(70);
  });
  it('excludes null pillars from the mean', () => {
    // only the 90 pillar counts → 90
    expect(compositeScore([P(90, 0.5), P(null, 0.5)])).toBe(90);
  });
});

describe('verdictFromComposite', () => {
  it('maps score bands to go/caution/nogo', () => {
    expect(verdictFromComposite(80)).toBe('go');
    expect(verdictFromComposite(50)).toBe('caution');
    expect(verdictFromComposite(20)).toBe('nogo');
    expect(verdictFromComposite(null)).toBe('insufficient');
  });
});

describe('rollUpPillarTruth', () => {
  it('is the weakest contributing pillar', () => {
    expect(rollUpPillarTruth([P(80, 1, 'verified'), P(60, 1, 'projected')])).toBe('projected');
    expect(rollUpPillarTruth([P(80, 1, 'verified'), P(60, 1, 'assumed')])).toBe('assumed');
    expect(rollUpPillarTruth([P(80, 1, 'verified')])).toBe('verified');
  });
  it('ignores null pillars when rolling up', () => {
    expect(rollUpPillarTruth([P(80, 1, 'verified'), P(null, 1, 'projected')])).toBe('verified');
  });
});

describe('scoreSiteFit', () => {
  it('flags missing pillars', () => {
    const r = scoreSiteFit([P(80, 0.5, 'verified'), P(null, 0.5, 'verified')]);
    expect(r.composite).toBe(80);
    expect(r.flags.some((f) => f.startsWith('pillars_missing'))).toBe(true);
  });
  it('returns insufficient when nothing scored', () => {
    const r = scoreSiteFit([P(null, 1)]);
    expect(r.verdict).toBe('insufficient');
    expect(r.flags).toContain('no_pillars_scored');
  });
  // QA v4: a demand pillar DEFINED but unscored (data-sparse edge geography) must NOT
  // let a lone secondary pillar manufacture a confident high score/Go.
  it('caps the composite + downgrades verdict when demand is defined but unscored', () => {
    const demand: Pillar = { key: 'demand', label: 'Catchment demand', score: null, weight: 0.5, truthLayer: 'verified' };
    const competition: Pillar = { key: 'competition', label: 'Competition', score: 100, weight: 0.35, truthLayer: 'verified' };
    const r = scoreSiteFit([demand, competition]);
    expect(r.composite).toBeLessThanOrEqual(44); // never a "go"
    expect(r.verdict).not.toBe('go');
    expect(r.truthLayer).not.toBe('verified'); // no primary demand read → not Verified
    expect(r.flags).toContain('low_confidence_no_demand_data');
  });
  it('does NOT cap when demand IS scored', () => {
    const demand: Pillar = { key: 'demand', label: 'Catchment demand', score: 90, weight: 0.5, truthLayer: 'verified' };
    const competition: Pillar = { key: 'competition', label: 'Competition', score: 90, weight: 0.35, truthLayer: 'verified' };
    const r = scoreSiteFit([demand, competition]);
    expect(r.composite).toBe(90);
    expect(r.verdict).toBe('go');
  });
});

describe('modulesForVertical', () => {
  it('always includes the core modules', () => {
    for (const m of CORE_MODULES) expect(modulesForVertical('fnb_cafe')).toContain(m);
  });
  it('activates daypart for cafes and healthcare for pharmacy', () => {
    expect(modulesForVertical('fnb_cafe')).toContain('daypart');
    expect(modulesForVertical('pharmacy')).toContain('healthcare');
  });
  it('does not give a fuel station mall scoring', () => {
    expect(modulesForVertical('fuel')).not.toContain('mall');
  });
  it('de-duplicates', () => {
    const mods = modulesForVertical('fnb_cafe');
    expect(new Set(mods).size).toBe(mods.length);
  });
});

describe('inferCorridor', () => {
  it('maps BGC/Taguig to BGC', () => {
    expect(inferCorridor('Taguig', 'Proposed — BGC High Street')).toBe('BGC');
  });
  it('maps Makati and Ortigas', () => {
    expect(inferCorridor('Makati', 'Ayala Ave')).toBe('Makati CBD');
    expect(inferCorridor('Pasig', 'Ortigas Center')).toBe('Ortigas');
  });
  // Phase 3 QA fix: QC and Pasay candidates must resolve to corridors that HAVE comps,
  // so Lease Benchmark runs instead of silently dropping.
  it('maps Quezon City variants to the QC corridor', () => {
    expect(inferCorridor('Quezon City', 'Proposed — QC Timog Ave')).toBe('Quezon City');
    expect(inferCorridor('Quezon City', 'Cubao Araneta')).toBe('Quezon City');
  });
  it('maps Pasay / Bay Area / MOA to the Pasay corridor', () => {
    expect(inferCorridor('Pasay', 'MOA Complex')).toBe('Pasay Bay Area');
    expect(inferCorridor(null, 'SM Mall of Asia')).toBe('Pasay Bay Area');
  });
  // QA v2: the remaining scenario cities must resolve to corridors that now have comps.
  it('maps Mandaluyong / Manila / Marikina / Alabang to their corridors', () => {
    expect(inferCorridor('Mandaluyong', 'SM Megamall')).toBe('Mandaluyong');
    expect(inferCorridor('Manila', 'Divisoria market')).toBe('Manila');
    expect(inferCorridor('Marikina', 'Marcos Highway')).toBe('Marikina');
    expect(inferCorridor('Muntinlupa', 'Festival Supermall')).toBe('Alabang');
  });
  // QA v4: edge geographies now resolve to secondary-market corridors.
  it('maps CAMANAVA + Las Piñas edge cities', () => {
    expect(inferCorridor('Valenzuela', 'edge site')).toBe('CAMANAVA');
    expect(inferCorridor('Caloocan', 'Monumento')).toBe('CAMANAVA');
    expect(inferCorridor('Las Piñas', 'Zapote')).toBe('Las Piñas');
  });
  it('prefers the most specific corridor token (BGC over Taguig city)', () => {
    expect(inferCorridor('Taguig', 'BGC High Street')).toBe('BGC');
  });
  // QA v6: full-NCR coverage — every LGU resolves to a corridor with comps.
  it('maps Pasig (by city) + San Juan + Pateros + Parañaque (QA v6)', () => {
    expect(inferCorridor('Pasig', 'Kapitolyo')).toBe('Ortigas');
    expect(inferCorridor('Pasig', 'San Antonio')).toBe('Ortigas');
    expect(inferCorridor('San Juan', 'Greenhills')).toBe('San Juan');
    expect(inferCorridor('Pateros', 'Sta Ana')).toBe('Pateros');
    expect(inferCorridor('Parañaque', 'BF Homes')).toBe('Pasay Bay Area');
    expect(inferCorridor('Malabon', 'Longos')).toBe('CAMANAVA');
    expect(inferCorridor('Navotas', 'M. Naval')).toBe('CAMANAVA');
  });
  // Region XI (Davao): Davao City vs the provincial cities resolve to their corridors.
  it('maps Region XI Davao corridors', () => {
    expect(inferCorridor('Davao City', 'SM Lanang')).toBe('Davao City');
    expect(inferCorridor('Davao City', 'Matina Crossing')).toBe('Davao City');
    expect(inferCorridor('Tagum', 'Poblacion')).toBe('Davao Provinces');
    expect(inferCorridor('Digos', 'National Highway')).toBe('Davao Provinces');
    expect(inferCorridor('Panabo', 'Poblacion')).toBe('Davao Provinces');
    expect(inferCorridor('Samal', 'Babak')).toBe('Davao Provinces');
    expect(inferCorridor('Mati', 'Central')).toBe('Davao Provinces');
  });
  it('returns null for unknown areas', () => {
    expect(inferCorridor('Baguio', 'Session Road')).toBeNull();
  });
});
