/**
 * Admin POI capture (2026-10-07) — the pure conversion layer: areas, layers, OSM element mapping,
 * the grid-navigator file import, category consistency with the CLI ingest, and the OSM natural key.
 */
import { describe, it, expect } from 'vitest';
import { areaKm2, bboxOfArea, containsPoint, areaRing, CaptureAreaSchema, MAX_CAPTURE_KM2 } from '@/lib/capture/area';
import { BASE_LAYERS, VERTICAL_LAYERS, BASE_LAYER_SELECTORS, isLayerKey } from '@/lib/capture/layers';
import { mapElement, parseSelector } from '@/lib/capture/mapElement';
import { parseOsmRef, dedupeCandidates, cleanText, type CaptureCandidate } from '@/lib/capture/candidate';
import { parseNavigatorFile, NavigatorFileError } from '@/lib/capture/navigatorFile';
import { captureCategory, osmTagToPoiCategory } from '@/lib/places/osmCategory';
import { OSM_SELECTORS } from '@/lib/places/osmService';
import { normalizePoi, poiDedupKey } from '@/lib/ingest/normalize';
import { claimLegacyOsmSql } from '@/lib/ingest/poiKeySql';

describe('capture areas', () => {
  const rect = { kind: 'rect' as const, south: 14.27, west: 121.08, north: 14.30, east: 121.11 };
  const circle = { kind: 'circle' as const, lat: 14.2116, lon: 121.1653, radiusM: 1000 };

  it('validates shape and Philippine bounds', () => {
    expect(CaptureAreaSchema.safeParse(rect).success).toBe(true);
    expect(CaptureAreaSchema.safeParse(circle).success).toBe(true);
    expect(CaptureAreaSchema.safeParse({ ...rect, north: 14.2 }).success).toBe(false); // inverted
    expect(CaptureAreaSchema.safeParse({ ...circle, lat: 35.6 }).success).toBe(false); // Tokyo
    expect(CaptureAreaSchema.safeParse({ ...circle, radiusM: 10 }).success).toBe(false);
  });

  it('computes area, bbox and containment', () => {
    expect(areaKm2(rect)).toBeGreaterThan(9);
    expect(areaKm2(rect)).toBeLessThan(11);
    expect(areaKm2(circle)).toBeCloseTo(Math.PI, 2);
    const [s, w, n, e] = bboxOfArea(circle);
    expect(s).toBeLessThan(circle.lat); expect(n).toBeGreaterThan(circle.lat);
    expect(w).toBeLessThan(circle.lon); expect(e).toBeGreaterThan(circle.lon);
    expect(containsPoint(circle, 14.2116, 121.1653)).toBe(true);
    // Corner of the bbox is outside the circle.
    expect(containsPoint(circle, n, e)).toBe(false);
    expect(containsPoint(rect, 14.28, 121.09)).toBe(true);
  });

  it('rings are closed polygons in [lon, lat] order', () => {
    for (const a of [rect, circle]) {
      const r = areaRing(a);
      expect(r[0]).toEqual(r[r.length - 1]);
      expect(r[0][0]).toBeGreaterThan(116); // lon first
    }
  });

  it('the per-request cap allows a district but not a city', () => {
    expect(areaKm2({ kind: 'circle', lat: 14.5, lon: 121, radiusM: 2800 })).toBeLessThan(MAX_CAPTURE_KM2);
    expect(areaKm2({ kind: 'rect', south: 14.2, west: 121.0, north: 14.4, east: 121.2 })).toBeGreaterThan(MAX_CAPTURE_KM2);
  });
});

describe('capture layers', () => {
  it('every competitor layer maps to a real osmService vertical', () => {
    for (const l of VERTICAL_LAYERS) expect(OSM_SELECTORS[l.key.slice(2)], l.key).toBeDefined();
  });
  it('every base selector parses to an exact key=value matcher', () => {
    for (const l of BASE_LAYERS) for (const sel of BASE_LAYER_SELECTORS[l.key as keyof typeof BASE_LAYER_SELECTORS]) expect(parseSelector(sel), sel).not.toBeNull();
  });
  it('rejects unknown layer keys and bare-key selectors', () => {
    expect(isLayerKey('anchors')).toBe(true);
    expect(isLayerKey('v:fnb_qsr')).toBe(true);
    expect(isLayerKey('v:"];out;')).toBe(false);
    expect(parseSelector('"shop"')).toBeNull();
  });
});

describe('category mapping stays consistent with the CLI ingest', () => {
  it('business tags keep the ingest category (so re-capture never hides a competitor)', () => {
    for (const k of ['amenity=pharmacy', 'shop=supermarket', 'amenity=fuel', 'amenity=bank', 'shop=water', 'amenity=fast_food']) {
      expect(captureCategory(k)).toBe(osmTagToPoiCategory(k));
    }
  });
  it('civic tags are never competitors (and a fire station is not transport)', () => {
    expect(captureCategory('amenity=place_of_worship')).toBe('anchor');
    expect(captureCategory('amenity=townhall')).toBe('office');
    expect(captureCategory('amenity=fire_station')).toBe('other');
    expect(osmTagToPoiCategory('amenity=fire_station')).toBe('transport'); // the old rule's quirk, kept for ingest
    expect(captureCategory('amenity=hospital')).toBe('hospital');
    expect(captureCategory('highway=bus_stop')).toBe('transport');
  });
});

describe('mapElement (Overpass → candidate)', () => {
  const m = [parseSelector('"amenity"="pharmacy"')!, parseSelector('"highway"="bus_stop"', true)!];
  it('keeps type + id as the key and Verified coordinates', () => {
    const c = mapElement({ type: 'way', id: 42, center: { lat: 14.3, lon: 121.1 }, tags: { amenity: 'pharmacy', name: 'Mercury Drug  Nuvali' } }, m) as CaptureCandidate;
    expect(c.osmType).toBe('way'); expect(c.osmId).toBe(42);
    expect(c.name).toBe('Mercury Drug Nuvali');
    expect(c.kind).toBe('amenity=pharmacy');
    expect(c.truthLayer).toBe('verified');
  });
  it('drops unnamed places, but labels unnamed transport stops', () => {
    expect(mapElement({ type: 'node', id: 1, lat: 14.3, lon: 121.1, tags: { amenity: 'pharmacy' } }, m)).toBe('unnamed');
    const stop = mapElement({ type: 'node', id: 2, lat: 14.3, lon: 121.1, tags: { highway: 'bus_stop' } }, m) as CaptureCandidate;
    expect(stop.name).toBe('Jeepney/bus stop');
  });
  it('trims circle captures to the circle', () => {
    const area = { kind: 'circle' as const, lat: 14.3, lon: 121.1, radiusM: 100 };
    expect(mapElement({ type: 'node', id: 3, lat: 14.31, lon: 121.1, tags: { amenity: 'pharmacy', name: 'X' } }, m, area)).toBe('outside_area');
  });
  it('ignores elements that match no requested tag', () => {
    expect(mapElement({ type: 'node', id: 4, lat: 14.3, lon: 121.1, tags: { shop: 'bakery', name: 'Y' } }, m)).toBe('no_match');
  });
});

describe('OSM references and de-duplication', () => {
  it('parses only real element refs', () => {
    expect(parseOsmRef('node/123')).toEqual({ osmType: 'node', osmId: 123 });
    expect(parseOsmRef('way/9')).toEqual({ osmType: 'way', osmId: 9 });
    expect(parseOsmRef('c1712-abc')).toBeNull();
    expect(parseOsmRef('node/-1')).toBeNull();
    expect(parseOsmRef('node/1; drop')).toBeNull();
  });
  it('node N and way N are different places', () => {
    const base = { name: 'A', kind: null, category: 'anchor' as const, lat: 14.3, lon: 121.1, source: 'osm' as const, truthLayer: 'verified' as const };
    const { kept } = dedupeCandidates([{ ...base, osmType: 'node', osmId: 7 }, { ...base, osmType: 'way', osmId: 7 }, { ...base, osmType: 'node', osmId: 7 }]);
    expect(kept).toHaveLength(2);
  });
  it('ingest dedup key includes the element type', () => {
    const n = normalizePoi({ osm_id: 7, osm_type: 'node', name: 'A', lat: 14.3, lon: 121.1 })!;
    const w = normalizePoi({ osm_id: 7, osm_type: 'way', name: 'A', lat: 14.3, lon: 121.1 })!;
    expect(poiDedupKey(n)).not.toBe(poiDedupKey(w));
    expect(normalizePoi({ osm_id: 7, osm_type: 'bogus', name: 'A', lat: 14.3, lon: 121.1 })!.osmType).toBeNull();
  });
  it('legacy rows are claimed only by a nearby element with the same id', () => {
    const sql = claimLegacyOsmSql([{ osmType: 'node', osmId: 7, lat: 14.3, lon: 121.1 }]);
    expect(sql.sql).toContain('p.osm_type IS NULL');
    expect(sql.sql).toContain('ST_DWithin');
    expect(sql.values).toContain(150);
  });
  it('cleans control characters and long names', () => {
    expect(cleanText('a\u0000b\n c', 10)).toBe('a b c');
    expect(cleanText('x'.repeat(300), 200)).toHaveLength(200);
  });
});

describe('grid-navigator session import', () => {
  const file = {
    format: 'grid-navigator-save', version: 3, savedAt: '2026-08-01T00:00:00Z',
    routes: [{ id: 'r1' }],
    tiles: { '15/1/2': 'AAAA', '15/1/3': 'BBBB' },
    checkpoints: [
      { id: 'c1', name: 'Vacant lot near SM', notes: 'For lease — ask guard', color: '#fff', lat: 14.2845, lng: 121.0966 },
      { id: 'c2', name: '', notes: '', color: '#fff', lat: 14.28, lng: 121.09 },
      { id: 'c3', name: 'Abroad', notes: '', color: '#fff', lat: 35.6, lng: 139.7 },
    ],
    pois: [
      { id: 'node/100', name: 'Mercury Drug', category: 'health', kind: 'amenity=pharmacy', lat: 14.28, lng: 121.09, city: 'Wrong City' },
      { id: 'node/101', name: 'Health', category: 'health', kind: 'amenity=clinic', lat: 14.28, lng: 121.09 },
      { id: 'node/102', name: 'Transit', category: 'transit', kind: 'highway=bus_stop', lat: 14.28, lng: 121.09 },
      { id: 'node/100', name: 'Mercury Drug', category: 'health', kind: 'amenity=pharmacy', lat: 14.28, lng: 121.09 },
      { id: 'not-an-osm-id', name: 'X', category: 'health', kind: 'amenity=pharmacy', lat: 14.28, lng: 121.09 },
      { id: 'node/103', name: 'Bad kind', category: 'health', kind: 'amenity=pharmacy](x)', lat: 14.28, lng: 121.09 },
    ],
  };

  it('converts POIs and checkpoints, never inventing names, ignoring tiles', () => {
    const r = parseNavigatorFile(file);
    const names = r.candidates.map((c) => c.name);
    expect(names).toContain('Mercury Drug');
    expect(names).toContain('Jeepney/bus stop'); // unnamed transit → generic stop label
    expect(names).not.toContain('Health'); // navigator placeholder name dropped
    expect(r.stats.skippedUnnamed).toBe(2); // the "Health" clinic + the empty checkpoint
    expect(r.stats.skippedInvalid).toBe(3); // bad id, bad kind, checkpoint in Japan
    expect(r.stats.duplicatesInFile).toBe(1);
    expect(r.stats.tilesIgnored).toBe(2);
    expect(r.stats.routesIgnored).toBe(1);
  });

  it('file POIs are Assumed; checkpoints become manual pins that need review', () => {
    const r = parseNavigatorFile(file);
    const drug = r.candidates.find((c) => c.name === 'Mercury Drug')!;
    expect(drug.truthLayer).toBe('assumed');
    expect(drug.osmType).toBe('node'); expect(drug.osmId).toBe(100);
    expect(drug.category).toBe('competitor'); // same as the CLI ingest
    expect(drug).not.toHaveProperty('city');
    const pin = r.candidates.find((c) => c.source === 'manual')!;
    expect(pin.needsReview).toBe(true);
    expect(pin.notes).toBe('For lease — ask guard');
    expect(pin.truthLayer).toBe('assumed');
  });

  it('accepts the legacy {checkpoints, routes} export and rejects other files', () => {
    expect(parseNavigatorFile({ checkpoints: [], routes: [] }).candidates).toHaveLength(0);
    expect(() => parseNavigatorFile({ hello: 'world' })).toThrow(NavigatorFileError);
    expect(() => parseNavigatorFile(null)).toThrow(NavigatorFileError);
  });
});
