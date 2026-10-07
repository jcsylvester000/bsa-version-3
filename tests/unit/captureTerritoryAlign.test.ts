/**
 * Place Capture ↔ Territory Guard alignment: the capture screen must count places exactly the way
 * the module does (catchment radii, name-based tiers, adjacent weight, saturation curve), and the
 * coverage cells it stamps must use the same keys Territory Guard's cache looks up.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
import {
  SITE_FORMATS, catchmentFor, DEFAULT_SCAN_M, CAPTURE_VERTICALS, isCaptureVertical, layersForSite,
  tierOfPlace, conceptForSite, summariseForTerritory, parseLatLon,
} from '@/lib/capture/territoryAlign';
import { FORMAT_CATCHMENT_M, competitiveSaturationPct } from '@/lib/modules/territoryMath';
import { conceptFor, tierFor, weightedCompetitorCount } from '@/lib/places/competitorRelevance';
import { VERTICAL_LABELS } from '@/lib/modules/verticalConfig';
import { OSM_SELECTORS } from '@/lib/places/osmService';
import { coverageCellKey, cellsForArea } from '@/lib/places/poiCache';

describe('same catchments and verticals as Territory Guard', () => {
  it('format radii are the module constants', () => {
    for (const f of SITE_FORMATS) expect(f.radiusM).toBe(FORMAT_CATCHMENT_M[f.key]);
    expect(catchmentFor('bogus')).toBe(FORMAT_CATCHMENT_M.default);
    expect(DEFAULT_SCAN_M).toBe(1500); // competitorsNear default
  });
  it('every business type is an intake vertical with an OSM competitor set', () => {
    for (const v of CAPTURE_VERTICALS) {
      expect(VERTICAL_LABELS).toHaveProperty(v.key);
      expect(OSM_SELECTORS[v.key], v.key).toBeDefined();
    }
    expect(isCaptureVertical('fnb_qsr')).toBe(true);
    expect(isCaptureVertical("x'; drop")).toBe(false);
  });
  it('the site layers lead with the vertical competitor set', () => {
    expect(layersForSite('fnb_cafe', ['anchors', 'transport'])).toEqual(['v:fnb_cafe', 'anchors', 'transport']);
    expect(layersForSite('', ['anchors'])).toEqual(['anchors']);
  });
});

describe('tiers and counts match the module', () => {
  const concept = conceptForSite('fnb_qsr', 'Jollibee')!;
  it('competitor rows are tiered by the module tierFor; everything else is context', () => {
    for (const name of ["McDonald's Nuvali", 'Mang Inasal', '7-Eleven', 'Mercury Drug', 'BDO']) {
      expect(tierOfPlace({ name, category: 'competitor' }, concept)).toBe(tierFor({ name, primaryType: null }, conceptFor('fnb_qsr', 'Jollibee')));
    }
    expect(tierOfPlace({ name: "McDonald's", category: 'transport' }, concept)).toBe('context');
    expect(tierOfPlace({ name: 'X', category: 'competitor' }, null)).toBe('unrelated');
  });
  it('only places inside the catchment count, with the module weights and curve', () => {
    const places = [
      { tier: 'direct' as const, distM: 300 }, { tier: 'direct' as const, distM: 800 },
      { tier: 'direct' as const, distM: 1400 }, // outside a 900 m catchment
      { tier: 'adjacent' as const, distM: 500 },
      { tier: 'unrelated' as const, distM: 100 }, { tier: 'context' as const, distM: 100 },
    ];
    const s = summariseForTerritory(places, 900);
    expect(s.catchment).toEqual({ direct: 2, adjacent: 1, unrelated: 1 });
    expect(s.ring).toEqual({ direct: 3, adjacent: 1, unrelated: 1, context: 1 });
    expect(s.weighted).toBe(weightedCompetitorCount({ direct: 2, adjacent: 1, unrelated: 1 }));
    expect(s.saturationPct).toBe(competitiveSaturationPct(s.weighted));
  });
});

describe('coordinates and coverage cells', () => {
  it('parses pasted coordinates and Google-Maps style fragments, PH only', () => {
    expect(parseLatLon('14.2846, 121.0966')).toEqual({ lat: 14.2846, lon: 121.0966 });
    expect(parseLatLon('https://maps.google.com/@14.5547,121.0244,15z')).toEqual({ lat: 14.5547, lon: 121.0244 });
    expect(parseLatLon('35.6, 139.7')).toBeNull();
    expect(parseLatLon('hello')).toBeNull();
  });
  it('stamped cell keys are the keys Territory Guard\'s cache reads', () => {
    const cells = cellsForArea(14.2846, 121.0966, 1500);
    expect(cells.length).toBeGreaterThan(4);
    for (const c of cells) expect(coverageCellKey(c.lat, c.lon)).toBe(c.key);
  });
});
