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
});

describe('rankWhiteSpaceRecommendations', () => {
  it('keeps only areas at/below the cannibalization threshold (40)', () => {
    const recs = rankWhiteSpaceRecommendations([
      area('A', 10, 5000),
      area('B', 40, 9000),
      area('C', 41, 10000),
      area('D', 80, 20000),
    ]);
    expect(recs.map((r) => r.barangay)).toContain('A');
    expect(recs.map((r) => r.barangay)).toContain('B'); // exactly 40 is allowed
    expect(recs.map((r) => r.barangay)).not.toContain('C');
    expect(recs.map((r) => r.barangay)).not.toContain('D');
    expect(recs.every((r) => r.cannibalizationPct <= 40)).toBe(true);
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

  it('dedupes by barangay, keeping the higher-scoring instance', () => {
    const recs = rankWhiteSpaceRecommendations([
      area('X', 30, 1000),
      area('X', 5, 9000),
      area('Y', 20, 5000),
    ]);
    expect(recs.filter((r) => r.barangay === 'X')).toHaveLength(1);
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

  it('returns nothing when every area is contested above the threshold', () => {
    expect(rankWhiteSpaceRecommendations([area('P', 55, 100), area('Q', 99, 100)])).toEqual([]);
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
