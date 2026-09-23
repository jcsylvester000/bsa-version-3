/**
 * R-07 — traffic-corridor row normalisation (band/truth coercion, seasonal validation, skip rules).
 */
import { describe, it, expect } from 'vitest';
import { trafficRowFrom, asBand, asTruth } from '@/lib/geo/trafficRow';

describe('asBand / asTruth', () => {
  it('coerces bands, defaulting to medium', () => {
    expect(asBand('very_high')).toBe('very_high');
    expect(asBand('HIGH')).toBe('high');
    expect(asBand('unknown')).toBe('medium');
  });
  it('coerces truth, defaulting to assumed', () => {
    expect(asTruth('verified')).toBe('verified');
    expect(asTruth('projected')).toBe('projected');
    expect(asTruth('')).toBe('assumed');
  });
});

describe('trafficRowFrom', () => {
  it('maps a corridor row and keeps only valid seasonal phases', () => {
    const r = trafficRowFrom({
      corridor: 'Lipa', baseBand: 'high', aadtRef: null, truthLayer: 'projected',
      source: 'DPWH ATTAS', notes: 'Ayala Hwy',
      seasonal: {
        normal: { low: 1.0, high: 1.0, label: 'Weekday' },
        christmas: { low: 1.25, high: 1.6, truthLayer: 'projected' },
        bogus: { low: 'x', high: 2 },
      },
    });
    expect(r?.corridor).toBe('Lipa');
    expect(r?.baseBand).toBe('high');
    expect(r?.aadtRef).toBeNull();
    expect(Object.keys(r!.seasonal).sort()).toEqual(['christmas', 'normal']); // bogus dropped
    expect(r?.seasonal.normal.truthLayer).toBe('projected'); // defaulted
  });

  it('parses a numeric aadtRef', () => {
    expect(trafficRowFrom({ corridor: 'Batangas City', aadtRef: 160000, seasonal: { normal: { low: 1, high: 1 } } })?.aadtRef).toBe(160000);
  });

  it('returns null without a corridor or without any valid seasonal phase', () => {
    expect(trafficRowFrom({ seasonal: { normal: { low: 1, high: 1 } } })).toBeNull();
    expect(trafficRowFrom({ corridor: 'X', seasonal: {} })).toBeNull();
    expect(trafficRowFrom({ corridor: 'X', seasonal: { bad: { low: 'a', high: 'b' } } })).toBeNull();
  });
});
