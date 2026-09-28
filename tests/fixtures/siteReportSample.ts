/** Sample site payloads mirroring a real Final Report (BGC High Street, BrewLab Tea) — test fixture. */
import type { SiteModulePayloads } from '@/lib/modules/siteReportModel';

export const SAMPLE_PAYLOADS: SiteModulePayloads = {
  territory: {
    verdict: 'redistributes', headlineSource: 'competitive', ownOutletOverlapPct: 0, competitiveSaturationPct: 71,
    competitorMix: { direct: 4, adjacent: 67, unrelated: 120 }, totalCannibalizedPhp: 0,
    competitorSet: { anchorBrand: 'Serenitea', competitors: ['Serenitea', 'CoCo', 'Gong Cha', 'Chatime', 'Tiger Sugar', 'Macao'], truthLayer: 'assumed' },
    affectedOutlets: [],
    truth: { overlapPct: 'verified', competitiveSaturation: 'projected', cannibalizedPhp: 'projected' },
  },
  lease: {
    corridor: 'BGC', sampleSize: 6, baseRentPercentile: null, verdict: 'corridor_benchmark', medianPhpSqm: 1650,
    freshness: { dataAsOf: '2026-04-01', isStale: false }, truth: { comps: 'assumed', zonalBand: 'verified' },
    ...({ zonal: { band: { classification: 'Commercial Regular', lowPhpSqm: 9000, highPhpSqm: 2160000 } } } as object),
  },
  daypart: {
    windowMatchPct: 74.3, daytimeShare: 74.3,
    seasonality: {
      peakSeason: { season: 'christmas', label: 'Christmas / ber-months peak (Nov 15–Jan 6)', low: 1.1, high: 1.3 },
      troughSeason: { season: 'holy_week', label: 'Holy Week — exodus, quieter malls & roads', low: 0.7, high: 0.85 },
    },
  },
  whitespace: {
    scanned: 214, threshold: 40,
    recommendations: [
      { rank: 1, barangay: 'Pasong Tamo', city: 'Quezon City', population: 30000, lat: 14.6, lon: 121, cannibalizationPct: 3, competitorMix: { direct: 0, adjacent: 2, unrelated: 5 }, weightedCompetitorCount: 1, nearestOwnM: null, nearbyBusinesses: [], recommendationScore: 90, verdict: 'open', reason: '' },
      { rank: 2, barangay: 'Signal Village', city: 'Taguig', population: 40000, lat: 14.5, lon: 121.05, cannibalizationPct: 5, competitorMix: { direct: 0, adjacent: 1, unrelated: 5 }, weightedCompetitorCount: 1, nearestOwnM: null, nearbyBusinesses: [], recommendationScore: 88, verdict: 'open', reason: '' },
      { rank: 3, barangay: 'Lower Bicutan', city: 'Taguig', population: 45000, lat: 14.49, lon: 121.06, cannibalizationPct: 0, competitorMix: { direct: 0, adjacent: 0, unrelated: 3 }, weightedCompetitorCount: 0, nearestOwnM: null, nearbyBusinesses: [], recommendationScore: 86, verdict: 'open', reason: '' },
      { rank: 4, barangay: 'Ususan', city: 'Taguig', population: 20000, lat: 14.53, lon: 121.07, cannibalizationPct: 8, competitorMix: { direct: 0, adjacent: 1, unrelated: 2 }, weightedCompetitorCount: 1, nearestOwnM: null, nearbyBusinesses: [], recommendationScore: 80, verdict: 'open', reason: '' },
      { rank: 5, barangay: 'Pinagsama', city: 'Taguig', population: 60000, lat: 14.52, lon: 121.05, cannibalizationPct: 12, competitorMix: { direct: 1, adjacent: 1, unrelated: 2 }, weightedCompetitorCount: 1, nearestOwnM: null, nearbyBusinesses: [], recommendationScore: 78, verdict: 'workable', reason: '' },
    ],
    ...({ proposed: { cannibalizationPct: 92 } } as object),
  },
  analysis: null,
};

export const SAMPLE_META = { composite: 66, rank: 1, total: 2, confidence: 'low' as const, analysedAt: 'Sep 28, 2026, 3:42 PM', truthPct: { verified: 0, assumed: 50, projected: 50 } };
