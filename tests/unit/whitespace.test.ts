import { describe, it, expect } from 'vitest';
import {
  rankWhiteSpaceRecommendations,
  whiteSpaceVerdict,
  WHITESPACE_CANNIBALIZATION_MAX,
  type WhiteSpaceArea,
} from '@/lib/modules/p2p3Math';

/** Small factory for a scored candidate area. */
function area(
  name: string,
  cannibalizationPct: number,
  population: number,
  extra: Partial<WhiteSpaceArea> = {},
): WhiteSpaceArea {
  return {
    psgcCode: name,
    barangay: name,
    city: 'Quezon City',
    population,
    lat: 14.63,
    lon: 121.03,
    cannibalizationPct,
    competitorMix: { direct: 0, adjacent: 0, unrelated: 0 },
    weightedCompetitorCount: 0,
    nearestOwnM: null,
    nearbyBusinesses: [],
    nearbyPoints: [],
    ...extra,
  };
}

describe('whiteSpaceVerdict', () => {
  it('is open below 15', () => {
    expect(whiteSpaceVerdict(0)).toBe('open');
    expect(whiteSpaceVerdict(14.9)).toBe('open');
  });
  it('is workable from 15 up to the threshold', () => {
    expect(whiteSpaceVerdict(15)).toBe('workable');
    expect(whiteSpaceVerdict(39.9)).toBe('workable');
  });
  it('is contested at/above the threshold', () => {
    expect(whiteSpaceVerdict(WHITESPACE_CANNIBALIZATION_MAX)).toBe('contested');
    expect(whiteSpaceVerdict(80)).toBe('contested');
  });
  it('accepts a custom threshold for the badge boundary', () => {
    expect(whiteSpaceVerdict(30, 25)).toBe('contested');
    expect(whiteSpaceVerdict(20, 25)).toBe('workable');
  });
});

describe('rankWhiteSpaceRecommendations', () => {
  it('ALWAYS returns the top alternatives, even when every area is above the threshold', () => {
    // The whole point of the enhancement: never dead-end. Best-available still comes back,
    // honestly badged, ranked by the blended score (cannibalization + demand).
    const recs = rankWhiteSpaceRecommendations([
      area('A', 55, 5000),
      area('B', 70, 9000),
      area('C', 90, 10000),
    ]);
    expect(recs.length).toBe(3);
    expect(recs.every((r) => r.verdict === 'contested')).toBe(true);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].recommendationScore).toBeGreaterThanOrEqual(recs[i].recommendationScore);
    }
  });

  it('assigns contiguous ranks sorted by descending recommendation score', () => {
    const recs = rankWhiteSpaceRecommendations([
      area('A', 5, 3000),
      area('B', 20, 8000),
      area('C', 12, 4000),
    ]);
    expect(recs.map((r) => r.rank)).toEqual([1, 2, 3]);
    for (let i = 1; i < recs.length; i++) {
      expect(recs[i - 1].recommendationScore).toBeGreaterThanOrEqual(recs[i].recommendationScore);
    }
  });

  it('rewards low cannibalization — a near-empty area outranks a saturated one of equal demand', () => {
    const [top] = rankWhiteSpaceRecommendations([
      area('Saturated', 38, 5000),
      area('Open', 3, 5000),
    ]);
    expect(top.barangay).toBe('Open');
  });

  it('marks whether each area beats the proposed site', () => {
    const recs = rankWhiteSpaceRecommendations(
      [area('Better', 20, 5000), area('Worse', 60, 5000)],
      { proposedCannibalizationPct: 45 },
    );
    const better = recs.find((r) => r.barangay === 'Better')!;
    const worse = recs.find((r) => r.barangay === 'Worse')!;
    expect(better.beatsProposed).toBe(true);   // 20 < 45
    expect(worse.beatsProposed).toBe(false);   // 60 > 45
  });

  it('leaves beatsProposed null when no proposed baseline is given', () => {
    const [rec] = rankWhiteSpaceRecommendations([area('A', 10, 1000)]);
    expect(rec.beatsProposed).toBeNull();
  });

  it('ranks on cannibalization alone when population is unknown (0) — the POI-fallback case', () => {
    const recs = rankWhiteSpaceRecommendations([
      area('Low', 10, 0),
      area('High', 50, 0),
    ]);
    expect(recs[0].barangay).toBe('Low');
  });

  it('dedupes by barangay, keeping the lower-cannibalization instance', () => {
    const recs = rankWhiteSpaceRecommendations([
      area('X', 30, 1000),
      area('X', 5, 9000),
      area('Y', 20, 5000),
    ]);
    expect(recs.filter((r) => r.barangay === 'X')).toHaveLength(1);
    expect(recs.find((r) => r.barangay === 'X')!.cannibalizationPct).toBe(5);
  });

  it('applies the limit', () => {
    const recs = rankWhiteSpaceRecommendations(
      [
        area('A', 5, 1000), area('B', 8, 2000), area('C', 12, 3000),
        area('D', 15, 4000), area('E', 20, 5000), area('F', 25, 6000),
      ],
      { limit: 5 },
    );
    expect(recs).toHaveLength(5);
  });

  it('returns nothing only when there are no candidate areas at all', () => {
    expect(rankWhiteSpaceRecommendations([])).toEqual([]);
  });

  it('carries the verdict and a human reason through onto each recommendation', () => {
    const [rec] = rankWhiteSpaceRecommendations([
      area('Cubao', 8, 6000, { competitorMix: { direct: 1, adjacent: 2, unrelated: 0 }, nearestOwnM: 1500 }),
    ]);
    expect(rec.verdict).toBe('open');
    expect(rec.reason).toContain('8% cannibalization');
    expect(rec.reason).toContain('1 direct rival');
  });
});
