'use client';

/**
 * Admin Place Capture — v3 (2026-10-07). Show on the map first, then save only what is new.
 *
 *   1 · Drop the site pin (any of the 18 regions)    → PSGC barangay/city/province of the pin
 *   2 · Business types (tick several) & catchment     → Territory Guard's rings + live read per type
 *   3 · Show places on the map                         → places BSA already holds come from the database;
 *                                                        OpenStreetMap is asked ONE LAYER AT A TIME, only for
 *                                                        layers this area has not been captured for (90 days);
 *                                                        only NEW places are listed
 *   4 · Review all captured areas, then Save           → status screen per area (saved / already in BSA /
 *                                                        barangay-tagged / coverage marked)
 *
 * The browser never calls OpenStreetMap or the database: everything goes through the admin-only
 * /api/admin/capture/* routes, and nothing is written until Save.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { defaultBasemapUrl, basemapPaint, OSM_ATTRIBUTION, OSM_MAX_ZOOM } from '@/lib/ui/theme';
import { listRegions } from '@/lib/geo/regions';
import { PH_REGIONS } from '@/lib/geo/phRegions';
import { geoCircle } from '@/lib/geo/mapGeometry';
import { ALL_LAYERS, BASE_LAYERS, type BaseLayerKey, type LayerKey } from '@/lib/capture/layers';
import { areaGeoJson, areaKm2, distanceM, MAX_CAPTURE_KM2, type CaptureArea } from '@/lib/capture/area';
import {
  CAPTURE_VERTICALS, SITE_FORMATS, DEFAULT_SCAN_M, MAX_CAPTURE_VERTICALS, catchmentFor, conceptForSite, layersForSite,
  parseLatLon, tierAcross, type PlaceTier, type SiteFormat, type TerritorySummary,
} from '@/lib/capture/territoryAlign';
import { BSA_POI_CATEGORIES, CATEGORY_LABEL, type BsaPoiCategory } from '@/lib/places/osmCategory';
import { markerElement } from '@/components/MapMarkers';
import { TruthChip } from '@/components/ui/Chips';

type Decision = 'accept' | 'reject' | 'pending';
type MapMode = 'site' | 'rect' | 'add' | 'none';
type Tab = 'capture' | 'import' | 'history';

interface BatchSummary { id: string; label: string; source: string; itemCount: number; committedCount: number; createdAt: string; createdBy: string | null }
interface SiteContext { site?: { lat: number; lon: number }; verticals?: string[]; vertical?: string; brand?: string; format?: SiteFormat }
interface Candidate {
  key: string; osmRef: string | null; name: string; kind: string | null; category: BsaPoiCategory;
  lat: number; lon: number; origin: 'osm' | 'file' | 'manual'; truthLayer: 'verified' | 'assumed';
  receipt?: string; existingPoiId: string | null; duplicateOf: { id: string; name: string } | null;
  needsReview?: boolean; notes?: string | null;
}
interface ReviewItem extends Candidate { decision: Decision; originalName: string; areaId: string }
interface StoredPlace { id: string; name: string; category: string; lat: number; lon: number; source: string; truthLayer: string; osmRef: string | null }
interface LayerRun { layer: LayerKey; status: 'waiting' | 'loading' | 'loaded' | 'covered' | 'failed'; found: number; newCount: number; inBsa: number; message?: string }
interface SaveResult { batchId: string; saved: number; alreadyInBsa: number; psgcTagged: number; coverageStamped: number }
interface VerticalRead { vertical: string; concept: { key: string; label: string } | null; summary: TerritorySummary }
/** One captured area (a ring around a pin, a rectangle, a file, or hand-placed pins). */
interface AreaRun {
  id: string;
  label: string;
  source: 'osm' | 'navigator_import' | 'manual';
  area?: CaptureArea;
  context?: SiteContext;
  layers: LayerRun[];
  stored: StoredPlace[];
  notes: string[];
  before?: VerticalRead[];
  after?: VerticalRead[];
  saved?: SaveResult;
  saveError?: string;
  readOnly?: boolean;
}
interface Readiness {
  boundary: { psgcCode: string; barangay: string | null; city: string | null; province: string | null; region: string | null } | null;
  region: string | null;
  catchmentM: number;
  radiusM: number;
  byVertical: VerticalRead[];
  coverage: Array<{ vertical: string; cells: number; fresh: number }>;
  places: Array<{ id: string; name: string; category: string; lat: number; lon: number; distM: number; tier: PlaceTier }>;
}
interface SavedBatch {
  batch: BatchSummary & { notes: string | null; areaSpec: (CaptureArea & { context?: SiteContext | null }) | null; layers: string[] };
  items: Array<{ key: string; osmRef: string | null; name: string; kind: string | null; category: BsaPoiCategory; lat: number; lon: number; truthLayer: 'verified' | 'assumed' | 'projected'; committedPoiId: string | null; notes: string | null }>;
}
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, error: { code: 'network', message: 'Network error — check your connection and try again.' } };
  }
  try {
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { ok: false, error: { code: `http_${res.status}`, message: `The server answered ${res.status}${res.status === 504 || res.status === 502 ? ' (it took too long)' : ''}. Nothing was saved.` } };
  }
}
const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

function initialDecision(c: Candidate): Decision {
  if (c.duplicateOf || c.needsReview) return 'pending';
  return 'accept';
}

const LAYER_LABEL: Record<string, string> = Object.fromEntries(ALL_LAYERS.map((l) => [l.key, l.label]));
let areaSeq = 0;
const newAreaId = () => `a${Date.now().toString(36)}${(areaSeq++).toString(36)}`;

/** Theme colour from the CSS tokens ("R G B" triplets) so the map follows dark/light. */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v.split(/\s+/).join(',')})` : fallback;
}

/** Territory Guard's marker vocabulary (MapMarkers / .mk-*) drawn as map icons, so thousands of
 *  points stay fast: direct = red diamond, adjacent = amber square, other = grey dot, context = ring. */
function addTierIcons(map: maplibregl.Map) {
  const dark = '#0E192F';
  const draw = (name: string, size: number, paint: (c: CanvasRenderingContext2D, s: number) => void) => {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d')!;
    paint(ctx, size);
    map.addImage(name, ctx.getImageData(0, 0, size, size), { pixelRatio: 2 });
  };
  draw('ic-direct', 40, (c, s) => {
    c.translate(s / 2, s / 2); c.rotate(Math.PI / 4);
    c.fillStyle = token('--nogo', '#F28C86'); c.strokeStyle = dark; c.lineWidth = 4;
    c.fillRect(-11, -11, 22, 22); c.strokeRect(-11, -11, 22, 22);
  });
  draw('ic-adjacent', 36, (c, s) => {
    c.fillStyle = token('--caution', '#E8B64C'); c.strokeStyle = dark; c.lineWidth = 4;
    c.fillRect(6, 6, s - 12, s - 12); c.strokeRect(6, 6, s - 12, s - 12);
  });
  draw('ic-unrelated', 20, (c, s) => {
    c.fillStyle = token('--border-strong', '#7084A8'); c.beginPath(); c.arc(s / 2, s / 2, 7, 0, Math.PI * 2); c.fill();
  });
  draw('ic-context', 28, (c, s) => {
    c.strokeStyle = token('--accent-text', '#E2B985'); c.lineWidth = 4; c.fillStyle = dark;
    c.beginPath(); c.arc(s / 2, s / 2, 9, 0, Math.PI * 2); c.fill(); c.stroke();
  });
}

const TIER_META: Record<PlaceTier, { label: string; short: string; glyph: string; rank: number; counted: boolean }> = {
  direct: { label: 'Direct competitor', short: 'Direct', glyph: '◆', rank: 4, counted: true },
  adjacent: { label: 'Adjacent format', short: 'Adjacent', glyph: '■', rank: 3, counted: true },
  unrelated: { label: 'Other business (not counted)', short: 'Other business', glyph: '●', rank: 2, counted: false },
  context: { label: 'Context place (transport, health, schools…)', short: 'Context', glyph: '○', rank: 1, counted: false },
};

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] };
const PAGE = 150;
const REGIONS = listRegions();
const CONTEXT_LAYERS: BaseLayerKey[] = ['anchors', 'transport', 'health', 'education', 'malls', 'offices'];

export function CaptureWorkbench() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const siteMarker = useRef<maplibregl.Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [tab, setTab] = useState<Tab>('capture');

  // Step 1 — site
  const [mode, setMode] = useState<MapMode>('site');
  const modeRef = useRef<MapMode>('site');
  const [site, setSite] = useState<{ lat: number; lon: number } | null>(null);
  const [coordText, setCoordText] = useState('');
  const [coordErr, setCoordErr] = useState<string | null>(null);
  // Step 2 — business types & catchment
  const [verticals, setVerticals] = useState<string[]>([]);
  const [brand, setBrand] = useState('');
  const [format, setFormat] = useState<SiteFormat>('inline');
  const [radiusM, setRadiusM] = useState(DEFAULT_SCAN_M);
  const [extras, setExtras] = useState<BaseLayerKey[]>(['anchors', 'transport', 'health', 'education']);
  const [refresh, setRefresh] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readyLoading, setReadyLoading] = useState(false);
  const [rect, setRect] = useState<CaptureArea | null>(null);
  const rectStart = useRef<{ lat: number; lon: number } | null>(null);
  // Session: every area captured since the last save, and the places found in them
  const [areas, setAreas] = useState<AreaRun[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [status, setStatus] = useState<null | { at: string; areas: AreaRun[] }>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [group, setGroup] = useState<'all' | PlaceTier | 'pending'>('all');
  const [areaFilter, setAreaFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [showCoverage, setShowCoverage] = useState(true);
  const [regionTotals, setRegionTotals] = useState<Array<{ region: string | null; total: number; tagged: number }>>([]);

  useEffect(() => { modeRef.current = mode; if (mode !== 'rect') rectStart.current = null; }, [mode]);

  const editableAreas = areas.filter((a) => !a.saved && !a.readOnly);
  const pendingItems = items.filter((i) => i.decision === 'pending' && editableAreas.some((a) => a.id === i.areaId));
  const acceptedItems = items.filter((i) => i.decision === 'accept' && editableAreas.some((a) => a.id === i.areaId));
  const unsaved = acceptedItems.length > 0;
  useEffect(() => {
    if (!unsaved) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [unsaved]);

  const catchmentM = catchmentFor(format);
  const conceptsByArea = useMemo(() => {
    const m = new Map<string, ReturnType<typeof conceptForSite>[]>();
    for (const a of areas) {
      const vs = a.context?.verticals ?? (a.context?.vertical ? [a.context.vertical] : []);
      m.set(a.id, vs.map((v) => conceptForSite(v, a.context?.brand)));
    }
    return m;
  }, [areas]);
  const area: CaptureArea | null = rect ?? (site ? { kind: 'circle', lat: site.lat, lon: site.lon, radiusM } : null);
  const km2 = area ? areaKm2(area) : 0;
  const tooBig = km2 > MAX_CAPTURE_KM2;
  const layers = layersForSite(verticals, extras);

  /* ---------------------------------------------------------------- data */

  const loadBatches = useCallback(async () => {
    const r = await api<BatchSummary[]>('/api/admin/capture/batches');
    if (r.ok) setBatches(r.data);
  }, []);

  const loadCoverage = useCallback(async () => {
    const r = await api<{ areas: Array<{ id: string; label: string; geometry: GeoJSON.Geometry | null }>; regions: typeof regionTotals }>('/api/admin/capture/coverage');
    if (!r.ok) return;
    setRegionTotals(r.data.regions ?? []);
    const src = mapRef.current?.getSource('coverage') as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: 'FeatureCollection', features: (r.data.areas ?? []).filter((a) => a.geometry).map((a) => ({ type: 'Feature', properties: { label: a.label }, geometry: a.geometry! })) });
  }, []);

  const readinessFor = useCallback(async (s: { lat: number; lon: number }, vs: string[], fmt: string, radius: number, br: string) => {
    const q = new URLSearchParams({ lat: String(s.lat), lon: String(s.lon), radiusM: String(radius), format: fmt, verticals: vs.join(','), brand: br.trim() });
    return api<Readiness>(`/api/admin/capture/readiness?${q.toString()}`);
  }, []);

  useEffect(() => {
    if (!site) { setReadiness(null); return; }
    const t = setTimeout(async () => {
      setReadyLoading(true);
      const r = await readinessFor(site, verticals, format, radiusM, brand);
      setReadyLoading(false);
      if (r.ok) setReadiness(r.data);
    }, 350);
    return () => clearTimeout(t);
  }, [site, verticals, format, radiusM, brand, readinessFor]);

  /** Places already saved in BSA inside the current view (zoom ≥ 14) — shown before any capture. */
  const loadViewport = useCallback(async () => {
    const map = mapRef.current;
    const src = map?.getSource('viewport') as maplibregl.GeoJSONSource | undefined;
    if (!map || !src) return;
    if (map.getZoom() < 14) { src.setData(EMPTY_FC); return; }
    const b = map.getBounds();
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(5)).join(',');
    const r = await api<Array<{ id: string; name: string; category: string; lat: number; lon: number }>>(`/api/admin/capture/pois?bbox=${bbox}`);
    if (!r.ok) return;
    src.setData({ type: 'FeatureCollection', features: r.data.map((p) => ({ type: 'Feature', properties: { name: p.name, icon: p.category === 'competitor' ? 'ic-unrelated' : 'ic-context' }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) });
  }, []);

  /* ---------------------------------------------------------------- map */

  const placeSite = useCallback((lat: number, lon: number, fly = false) => {
    const p = { lat: round6(lat), lon: round6(lon) };
    setSite(p);
    setRect(null);
    const map = mapRef.current;
    if (!map) return;
    if (!siteMarker.current) {
      siteMarker.current = new maplibregl.Marker({ element: markerElement('site', 'Site pin — drag to adjust'), draggable: true, anchor: 'bottom' })
        .setLngLat([p.lon, p.lat]).addTo(map);
      siteMarker.current.on('dragend', () => {
        const ll = siteMarker.current!.getLngLat();
        setSite({ lat: round6(ll.lat), lon: round6(ll.lng) });
      });
    } else {
      siteMarker.current.setLngLat([p.lon, p.lat]);
    }
    if (fly) {
      const dLat = 1700 / 111_320, dLon = 1700 / (111_320 * Math.cos((p.lat * Math.PI) / 180));
      map.fitBounds([[p.lon - dLon, p.lat - dLat], [p.lon + dLon, p.lat + dLat]], { padding: 24, duration: 600 });
    }
  }, []);

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    let cancelled = false;
    (async () => {
      let tiles = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? defaultBasemapUrl();
      let attribution = OSM_ATTRIBUTION;
      try {
        const j = await fetch('/api/maptiles').then((x) => x.json());
        if (j.ok && j.data?.tileUrlTemplate) { tiles = j.data.tileUrlTemplate; attribution = '© Google'; }
      } catch { /* default basemap */ }
      if (cancelled || !mapEl.current) return;
      const map = new maplibregl.Map({
        container: mapEl.current,
        style: { version: 8, sources: { base: { type: 'raster', tiles: [tiles], tileSize: 256, attribution, maxzoom: OSM_MAX_ZOOM } }, layers: [{ id: 'base', type: 'raster', source: 'base', paint: basemapPaint(tiles) }] },
        center: [121.0244, 14.5547],
        zoom: 11,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        addTierIcons(map);
        const accent = token('--accent-text', '#E2B985');
        for (const id of ['coverage', 'areas', 'catchment', 'scan', 'rect', 'viewport', 'existing', 'items']) map.addSource(id, { type: 'geojson', data: EMPTY_FC });
        map.addLayer({ id: 'coverage-fill', type: 'fill', source: 'coverage', paint: { 'fill-color': token('--projected', '#B39AE8'), 'fill-opacity': 0.07 } });
        map.addLayer({ id: 'coverage-line', type: 'line', source: 'coverage', paint: { 'line-color': token('--projected', '#B39AE8'), 'line-width': 1, 'line-dasharray': [2, 2] } });
        map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': token('--go', '#5CCB98'), 'line-width': 1.5 } });
        map.addLayer({ id: 'scan-line', type: 'line', source: 'scan', paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [3, 2] } });
        map.addLayer({ id: 'rect-fill', type: 'fill', source: 'rect', paint: { 'fill-color': accent, 'fill-opacity': 0.08 } });
        map.addLayer({ id: 'rect-line', type: 'line', source: 'rect', paint: { 'line-color': accent, 'line-width': 2 } });
        map.addLayer({ id: 'catchment-fill', type: 'fill', source: 'catchment', paint: { 'fill-color': accent, 'fill-opacity': 0.12 } });
        map.addLayer({ id: 'catchment-line', type: 'line', source: 'catchment', paint: { 'line-color': accent, 'line-width': 2 } });
        map.addLayer({ id: 'viewport-icons', type: 'symbol', source: 'viewport', layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-size': 0.7 }, paint: { 'icon-opacity': 0.45 } });
        map.addLayer({
          id: 'existing-icons', type: 'symbol', source: 'existing',
          layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-size': 0.8, 'symbol-sort-key': ['get', 'rank'] },
          paint: { 'icon-opacity': 0.55 },
        });
        map.addLayer({ id: 'items-pending', type: 'circle', source: 'items', filter: ['==', ['get', 'decision'], 'pending'], paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': token('--caution', '#E8B64C'), 'circle-stroke-width': 2.5 } });
        map.addLayer({ id: 'items-selected', type: 'circle', source: 'items', filter: ['==', ['get', 'selected'], 1], paint: { 'circle-radius': 15, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': token('--text', '#EDF2FB'), 'circle-stroke-width': 2 } });
        map.addLayer({
          id: 'items-icons', type: 'symbol', source: 'items',
          layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'symbol-sort-key': ['get', 'rank'] },
          paint: { 'icon-opacity': ['match', ['get', 'decision'], 'reject', 0.25, 1] },
        });
        setMapReady(true);
      });
      map.on('moveend', () => { void loadViewport(); });
      map.on('click', 'items-icons', (e) => {
        const key = e.features?.[0]?.properties?.key;
        if (key && modeRef.current === 'none') setSelected(String(key));
      });
      for (const layerId of ['existing-icons', 'viewport-icons']) {
        map.on('click', layerId, (e) => {
          if (modeRef.current !== 'none') return;
          const f = e.features?.[0];
          if (f) new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat).setText(`${f.properties?.name} — already saved in BSA`).addTo(map);
        });
      }
      map.on('click', (e) => {
        const lat = e.lngLat.lat, lon = e.lngLat.lng;
        const m = modeRef.current;
        if (m === 'site') { placeSite(lat, lon); setMode('none'); }
        else if (m === 'add') { setPin({ lat: round6(lat), lon: round6(lon) }); }
        else if (m === 'rect') {
          if (!rectStart.current) { rectStart.current = { lat, lon }; }
          else {
            const a = rectStart.current;
            rectStart.current = null;
            setRect({ kind: 'rect', south: Math.min(a.lat, lat), north: Math.max(a.lat, lat), west: Math.min(a.lon, lon), east: Math.max(a.lon, lon) });
            setMode('none');
          }
        }
      });
      map.on('mousemove', (e) => {
        map.getCanvas().style.cursor = modeRef.current === 'none' ? '' : 'crosshair';
        if (modeRef.current !== 'rect' || !rectStart.current) return;
        const a = rectStart.current;
        const live: CaptureArea = { kind: 'rect', south: Math.min(a.lat, e.lngLat.lat), north: Math.max(a.lat, e.lngLat.lat), west: Math.min(a.lon, e.lngLat.lng), east: Math.max(a.lon, e.lngLat.lng) };
        (map.getSource('rect') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'Feature', properties: {}, geometry: areaGeoJson(live) });
      });
    })();
    return () => { cancelled = true; siteMarker.current = null; mapRef.current?.remove(); mapRef.current = null; };
    // Mount-only: builds the maplibre instance once (handlers read live state through refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current!;
    const set = (id: string, data: GeoJSON.Feature | GeoJSON.FeatureCollection) => (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    set('catchment', site ? geoCircle(site.lon, site.lat, catchmentM) as GeoJSON.Feature : EMPTY_FC);
    set('scan', site && !rect ? geoCircle(site.lon, site.lat, radiusM) as GeoJSON.Feature : EMPTY_FC);
    set('rect', rect ? { type: 'Feature', properties: {}, geometry: areaGeoJson(rect) } : EMPTY_FC);
    set('areas', { type: 'FeatureCollection', features: areas.filter((a) => a.area).map((a) => ({ type: 'Feature', properties: { label: a.label }, geometry: areaGeoJson(a.area!) })) });
  }, [site, catchmentM, radiusM, rect, areas, mapReady]);

  // Places already in BSA: inside captured areas (tiered as Territory Guard sees them) + the current ring.
  useEffect(() => {
    if (!mapReady) return;
    const features: GeoJSON.Feature[] = [];
    const seen = new Set<string>();
    for (const a of areas) {
      const concepts = conceptsByArea.get(a.id) ?? [];
      for (const p of a.stored) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const tier = tierAcross(p, concepts);
        features.push({ type: 'Feature', properties: { name: p.name, icon: `ic-${tier}`, rank: TIER_META[tier].rank }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
      }
    }
    for (const p of readiness?.places ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      features.push({ type: 'Feature', properties: { name: p.name, icon: `ic-${p.tier}`, rank: TIER_META[p.tier].rank }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
    }
    (mapRef.current?.getSource('existing') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
  }, [areas, readiness, conceptsByArea, mapReady]);

  const tiered = useMemo(() => items.map((it) => ({ ...it, tier: tierAcross(it, conceptsByArea.get(it.areaId) ?? []) })), [items, conceptsByArea]);
  useEffect(() => {
    if (!mapReady) return;
    (mapRef.current?.getSource('items') as maplibregl.GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: tiered.map((it) => ({
        type: 'Feature',
        properties: { key: it.key, decision: it.decision, icon: `ic-${it.tier}`, rank: TIER_META[it.tier].rank + 10, selected: it.key === selected ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [it.lon, it.lat] },
      })),
    });
  }, [tiered, selected, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    for (const id of ['coverage-fill', 'coverage-line']) mapRef.current?.setLayoutProperty(id, 'visibility', showCoverage ? 'visible' : 'none');
  }, [showCoverage, mapReady]);

  useEffect(() => { if (mapReady) { void loadBatches(); void loadCoverage(); void loadViewport(); } }, [mapReady, loadBatches, loadCoverage, loadViewport]);
  useEffect(() => { if (selected) document.getElementById(`cap-row-${cssId(selected)}`)?.scrollIntoView({ block: 'nearest' }); }, [selected]);

  /* ---------------------------------------------------------------- capture */

  function goToCoords() {
    const p = parseLatLon(coordText);
    if (!p) { setCoordErr('Use “latitude, longitude” inside the Philippines, e.g. 14.2846, 121.0966'); return; }
    setCoordErr(null);
    placeSite(p.lat, p.lon, true);
    setMode('none');
  }

  function fitToPoints(pts: Array<{ lat: number; lon: number }>) {
    if (!pts.length || !mapRef.current) return;
    let s = 90, w = 180, n = -90, e = -180;
    for (const p of pts) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); }
    mapRef.current.fitBounds([[w, s], [e, n]], { padding: 48, maxZoom: 16, duration: 600 });
  }

  const patchArea = (id: string, fn: (a: AreaRun) => AreaRun) => setAreas((as) => as.map((a) => (a.id === id ? fn(a) : a)));

  /** Merge new candidates into the session, skipping places another area already listed. */
  const addItems = (areaId: string, cands: Candidate[]) => setItems((cur) => {
    const have = new Set(cur.map((i) => i.key));
    const add = cands.filter((c) => !have.has(c.key)).map((c) => ({ ...c, decision: initialDecision(c), originalName: c.name, areaId }));
    return [...cur, ...add];
  });

  /** Load one layer for an area (DB places on the first call). Never writes. */
  async function runLayer(areaId: string, a: CaptureArea, layer: LayerKey, withStored: boolean, force: boolean) {
    patchArea(areaId, (x) => ({ ...x, layers: x.layers.map((l) => (l.layer === layer ? { ...l, status: 'loading', message: undefined } : l)) }));
    const r = await api<{ layers: Array<Omit<LayerRun, 'layer'> & { layer: string }>; candidates: Candidate[]; stored?: StoredPlace[]; notes: string[] }>(
      '/api/admin/capture/preview', jsonInit('POST', { area: a, layers: [layer], withStored, refresh: force }),
    );
    if (!r.ok) {
      patchArea(areaId, (x) => ({ ...x, layers: x.layers.map((l) => (l.layer === layer ? { ...l, status: 'failed', message: r.error.message } : l)) }));
      return;
    }
    const lr = r.data.layers[0];
    patchArea(areaId, (x) => ({
      ...x,
      stored: r.data.stored ?? x.stored,
      notes: [...new Set([...x.notes, ...r.data.notes])],
      layers: x.layers.map((l) => (l.layer === layer ? { ...l, ...lr, layer } : l)),
    }));
    addItems(areaId, r.data.candidates);
  }

  async function showOnMap() {
    if (!area || tooBig || !layers.length) return;
    const id = newAreaId();
    const label = [verticals.map((v) => CAPTURE_VERTICALS.find((x) => x.key === v)?.label).filter(Boolean).join(' + '), brand.trim(), readiness?.boundary?.barangay ? `Brgy ${readiness.boundary.barangay}` : null, readiness?.boundary?.city]
      .filter(Boolean).join(' · ') || 'Capture area';
    const run: AreaRun = {
      id, label, source: 'osm', area, layers: layers.map((l) => ({ layer: l, status: 'waiting', found: 0, newCount: 0, inBsa: 0 })),
      context: { site: site ?? undefined, verticals, brand: brand.trim() || undefined, format },
      stored: [], notes: [], before: readiness?.byVertical,
    };
    setStatus(null); setMsg(null); setConfirmSave(false);
    setAreas((as) => [...as, run]);
    setBusy('Loading places…');
    for (let i = 0; i < layers.length; i++) {
      setBusy(`Loading ${LAYER_LABEL[layers[i]] ?? layers[i]} (${i + 1} of ${layers.length})…`);
      await runLayer(id, area, layers[i], i === 0, refresh);
    }
    setBusy(null);
    setMsg({ tone: 'ok', text: 'Places are on the map. Places BSA already has are shown faded and will not be saved again. Review the new ones, then press Save.' });
    setTimeout(() => document.getElementById('cap-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function retryLayer(a: AreaRun, layer: LayerKey) {
    if (!a.area) return;
    setBusy(`Retrying ${LAYER_LABEL[layer] ?? layer}…`);
    await runLayer(a.id, a.area, layer, a.stored.length === 0, true);
    setBusy(null);
  }

  async function importFile(file: File) {
    if (file.size > 10 * 1024 * 1024) { setMsg({ tone: 'err', text: 'File is larger than 10 MB. In Grid Navigator, save the session without cached map tiles.' }); return; }
    setBusy('Reading the Grid Navigator session…'); setMsg(null); setStatus(null);
    const text = await file.text();
    const r = await api<{ candidates: Candidate[]; notes: string[]; label: string; alreadyInBsa: number }>('/api/admin/capture/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-file-name': file.name.replace(/[^\x20-\x7e]/g, '_').slice(0, 80) }, body: text,
    });
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    const id = newAreaId();
    setAreas((as) => [...as, { id, label: r.data.label, source: 'navigator_import', layers: [], stored: [], notes: r.data.notes }]);
    addItems(id, r.data.candidates);
    setMsg({ tone: 'ok', text: `${r.data.candidates.length} new places from the session are on the map${r.data.alreadyInBsa ? ` (${r.data.alreadyInBsa} already in BSA are left out)` : ''}. Review them, then press Save.` });
    fitToPoints(r.data.candidates);
  }

  function addPin(form: { name: string; category: BsaPoiCategory; notes: string }) {
    if (!pin) return;
    let target = editableAreas.find((a) => a.area && pin && distanceM(a.area.kind === 'circle' ? a.area.lat : (a.area.south + a.area.north) / 2, a.area.kind === 'circle' ? a.area.lon : (a.area.west + a.area.east) / 2, pin.lat, pin.lon) < 3_000);
    if (!target) {
      target = editableAreas.find((a) => a.source === 'manual');
      if (!target) {
        target = { id: newAreaId(), label: 'Places added by hand', source: 'manual', layers: [], stored: [], notes: [] };
        const t = target;
        setAreas((as) => [...as, t]);
      }
    }
    const item: ReviewItem = {
      key: `m:${Date.now()}:${pin.lat}:${pin.lon}`, osmRef: null, name: form.name, kind: null, category: form.category,
      lat: pin.lat, lon: pin.lon, origin: 'manual', truthLayer: 'assumed', existingPoiId: null, duplicateOf: null,
      notes: form.notes || null, decision: 'accept', originalName: form.name, areaId: target.id,
    };
    setItems((cur) => [item, ...cur]);
    setPin(null); setMode('none');
    setMsg({ tone: 'ok', text: `“${form.name}” is on the map (Assumed). It will be saved with the next Save.` });
  }

  function updateItems(keys: string[], patch: Partial<Pick<ReviewItem, 'decision' | 'name' | 'category'>>) {
    const set = new Set(keys);
    setItems((cur) => cur.map((it) => (set.has(it.key) ? { ...it, ...patch } : it)));
  }

  function removeArea(a: AreaRun) {
    if (!a.saved && items.some((i) => i.areaId === a.id && i.decision === 'accept') && !window.confirm('This area has places that are not saved. Remove it from the map?')) return;
    setAreas((as) => as.filter((x) => x.id !== a.id));
    setItems((cur) => cur.filter((i) => i.areaId !== a.id));
  }

  /** The only write: one save per area, then a status screen. */
  async function saveAll() {
    const targets = editableAreas.filter((a) => items.some((i) => i.areaId === a.id && i.decision === 'accept') || a.layers.some((l) => l.status === 'loaded'));
    if (!targets.length) return;
    setConfirmSave(false); setMsg(null);
    const done: AreaRun[] = [];
    for (let i = 0; i < targets.length; i++) {
      const a = targets[i];
      setBusy(`Saving area ${i + 1} of ${targets.length}…`);
      const its = items.filter((x) => x.areaId === a.id && x.decision === 'accept');
      const r = await api<SaveResult>('/api/admin/capture/save', jsonInit('POST', {
        source: a.source, label: a.label, area: a.area, layers: a.layers.map((l) => l.layer),
        fetchedLayers: a.layers.filter((l) => l.status === 'loaded').map((l) => l.layer), context: a.context,
        items: its.map((x) => ({ osmRef: x.osmRef, receipt: x.receipt ?? null, name: x.name, kind: x.kind, category: x.category, lat: x.lat, lon: x.lon, origin: x.origin, notes: x.notes ?? null })),
      }));
      let after: VerticalRead[] | undefined;
      if (r.ok && a.context?.site && a.context.verticals?.length && a.area?.kind === 'circle') {
        const rr = await readinessFor(a.context.site, a.context.verticals, a.context.format ?? 'inline', a.area.radiusM, a.context.brand ?? '');
        if (rr.ok) after = rr.data.byVertical;
      }
      const updated: AreaRun = r.ok ? { ...a, saved: r.data, after, saveError: undefined } : { ...a, saveError: r.error.message };
      done.push(updated);
      patchArea(a.id, () => updated);
    }
    setBusy(null);
    setStatus({ at: new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' }), areas: done });
    await loadBatches(); await loadCoverage(); await loadViewport();
    if (site) { const rr = await readinessFor(site, verticals, format, radiusM, brand); if (rr.ok) setReadiness(rr.data); }
    setTimeout(() => document.getElementById('cap-status')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  function startOver() {
    if (unsaved && !window.confirm('Some places on the map are not saved. Clear them?')) return;
    setAreas([]); setItems([]); setStatus(null); setMsg(null);
  }

  async function openBatch(id: string) {
    const r = await api<SavedBatch>(`/api/admin/capture/batches/${id}`);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    const b = r.data.batch;
    const aid = newAreaId();
    const ctx = b.areaSpec?.context ?? undefined;
    setAreas((as) => [...as, { id: aid, label: `${b.label} (saved)`, source: b.source as AreaRun['source'], area: b.areaSpec ?? undefined, context: ctx, layers: [], stored: [], notes: b.notes ? [b.notes] : [], readOnly: true }]);
    setItems((cur) => [...cur, ...r.data.items.filter((it) => !cur.some((c) => c.key === it.key)).map((it) => ({
      ...it, origin: (it.osmRef ? 'osm' : 'manual') as Candidate['origin'], truthLayer: (it.truthLayer === 'verified' ? 'verified' : 'assumed') as Candidate['truthLayer'],
      existingPoiId: it.committedPoiId, duplicateOf: null, decision: 'accept' as Decision, originalName: it.name, areaId: aid,
    }))]);
    if (ctx?.site) placeSite(ctx.site.lat, ctx.site.lon, true); else fitToPoints(r.data.items);
  }

  function flyTo(lat: number, lon: number, zoom = 13) { mapRef.current?.flyTo({ center: [lon, lat], zoom }); }
  function toggleVertical(v: string, on: boolean) {
    setVerticals((vs) => (on ? (vs.includes(v) || vs.length >= MAX_CAPTURE_VERTICALS ? vs : [...vs, v]) : vs.filter((x) => x !== v)));
  }

  /* ---------------------------------------------------------------- derived */

  const areaById = useMemo(() => new Map(areas.map((a) => [a.id, a])), [areas]);
  const counts = useMemo(() => {
    const c = { direct: 0, adjacent: 0, unrelated: 0, context: 0, pending: 0 };
    for (const it of tiered) { if (areaFilter !== 'all' && it.areaId !== areaFilter) continue; c[it.tier]++; if (it.decision === 'pending') c.pending++; }
    return c;
  }, [tiered, areaFilter]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tiered
      .filter((it) => areaFilter === 'all' || it.areaId === areaFilter)
      .filter((it) => (group === 'all' ? true : group === 'pending' ? it.decision === 'pending' : it.tier === group))
      .filter((it) => !q || it.name.toLowerCase().includes(q) || (it.kind ?? '').includes(q))
      .sort((a, b) => (a.decision === 'pending' ? -1 : 0) - (b.decision === 'pending' ? -1 : 0) || TIER_META[b.tier].rank - TIER_META[a.tier].rank || a.name.localeCompare(b.name));
  }, [tiered, group, search, areaFilter]);

  const step1Done = !!site || !!rect;
  const step2Done = step1Done && verticals.length > 0;
  const loading = areas.some((a) => a.layers.some((l) => l.status === 'loading' || l.status === 'waiting'));
  const stage: 0 | 1 | 2 = status ? 2 : areas.length ? 1 : 0;

  /* ---------------------------------------------------------------- render */

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap items-center gap-2 text-label" aria-label="Progress">
        {(['1–2 · Set up the site', '3 · Places shown on the map', '4 · Saved to BSA'] as const).map((l, i) => {
          const done = stage > i;
          const now = stage === i;
          return (
            <li key={l} className={`rounded-full border px-3 py-1 ${now ? 'border-accent-soft bg-ink-hover text-ink-text' : done ? 'border-go text-go' : 'border-ink-border text-ink-muted'}`} aria-current={now ? 'step' : undefined}>
              {done ? '✓ ' : ''}{l}
            </li>
          );
        })}
      </ol>

      <div role="tablist" aria-label="Place Capture" className="flex flex-wrap gap-2">
        {([['capture', 'Capture around a site'], ['import', 'Import a field session'], ['history', 'Saved captures']] as Array<[Tab, string]>).map(([t, l]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`btn min-h-[40px] px-4 text-label ${tab === t ? 'bg-ink-hover font-semibold text-ink-text shadow-[inset_0_-2px_0_#BE8562]' : 'border border-ink-border text-ink-muted'}`}>{l}</button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          {tab === 'capture' && (
            <>
              <Step n={1} title="Drop the site pin" done={step1Done}>
                <p className="field-help">Jump to any region, then click the map where the site is (drag the pin to fine-tune), or paste coordinates.</p>
                <div className="mt-3 flex gap-2">
                  <select aria-label="Jump to region" className="field min-h-[40px] flex-1" value="" onChange={(e) => {
                    const v = e.target.value;
                    const r = PH_REGIONS.find((x) => x.code === v);
                    if (r) { flyTo(r.centre.lat, r.centre.lon, 12); return; }
                    const p = REGIONS.find((x) => `bsa:${x.key}` === v);
                    if (p) flyTo(p.warmCentres[0].lat, p.warmCentres[0].lon, 12);
                  }}>
                    <option value="" disabled>Jump to a region…</option>
                    <optgroup label="All regions of the Philippines">
                      {PH_REGIONS.map((r) => <option key={r.code} value={r.code}>{r.name} — {r.centre.label}</option>)}
                    </optgroup>
                    <optgroup label="Provinces with BSA reference data">
                      {REGIONS.map((r) => <option key={r.key} value={`bsa:${r.key}`}>{r.name}</option>)}
                    </optgroup>
                  </select>
                  <button type="button" className={`btn-secondary min-h-[40px] px-3 text-label ${mode === 'site' ? 'border-accent-soft text-ink-text' : ''}`} onClick={() => setMode(mode === 'site' ? 'none' : 'site')}>
                    {mode === 'site' ? 'Click the map…' : site ? 'Move pin' : 'Drop pin'}
                  </button>
                </div>
                <div className="mt-2 flex gap-2">
                  <input aria-label="Coordinates" className="field min-h-[40px] flex-1" placeholder="14.2846, 121.0966" value={coordText}
                    onChange={(e) => setCoordText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && goToCoords()} />
                  <button type="button" className="btn-secondary min-h-[40px] px-3 text-label" onClick={goToCoords}>Go</button>
                </div>
                {coordErr && <p className="field-msg mt-1">{coordErr}</p>}
                {site && (
                  <div className="card-inset mt-3 p-3 text-label font-normal">
                    <p className="text-ink-text"><span aria-hidden>📍</span> {site.lat.toFixed(6)}, {site.lon.toFixed(6)}</p>
                    {readyLoading && !readiness ? <p className="text-ink-muted">Locating…</p>
                      : readiness?.boundary
                        ? <p className="text-ink-muted">Brgy {readiness.boundary.barangay ?? '—'}, {readiness.boundary.city ?? '—'}{readiness.boundary.province ? `, ${readiness.boundary.province}` : ''} <span className="opacity-70">· PSGC {readiness.boundary.psgcCode}</span></p>
                        : readiness && <p className="text-caution">▲ No barangay boundary loaded here. Places still save with exact coordinates; load the region&apos;s boundaries to tag barangays.</p>}
                  </div>
                )}
              </Step>

              <Step n={2} title="Business types & catchment" done={step2Done} disabled={!step1Done}>
                <fieldset disabled={!step1Done}>
                  <legend className="field-label">Business types — tick up to {MAX_CAPTURE_VERTICALS} (what Territory Guard compares against)</legend>
                  <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                    {CAPTURE_VERTICALS.map((v) => (
                      <label key={v.key} className="flex items-center gap-2 text-label">
                        <input type="checkbox" checked={verticals.includes(v.key)} disabled={!verticals.includes(v.key) && verticals.length >= MAX_CAPTURE_VERTICALS}
                          onChange={(e) => toggleVertical(v.key, e.target.checked)} />
                        <span>{v.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="mt-3 block"><span className="field-label">Brand (optional — sharpens which rivals count)</span>
                  <input className="field mt-1" value={brand} maxLength={80} placeholder="e.g. Macao Imperial Tea" onChange={(e) => setBrand(e.target.value)} disabled={!step1Done} />
                </label>
                <fieldset className="mt-3" disabled={!step1Done}>
                  <legend className="field-label">Site format → catchment ring</legend>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {SITE_FORMATS.map((f) => (
                      <button key={f.key} type="button" aria-pressed={format === f.key} onClick={() => setFormat(f.key)}
                        className={`rounded-control border px-2 py-2 text-label ${format === f.key ? 'border-accent-soft bg-ink-hover text-ink-text' : 'border-ink-border text-ink-muted'}`}>
                        {f.label}<span className="block text-ink-muted">{f.radiusM.toLocaleString('en-US')} m</span>
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="mt-3 block">
                  <span className="field-label">Capture ring: {radiusM.toLocaleString('en-US')} m {radiusM === DEFAULT_SCAN_M && <span className="opacity-70">(Territory Guard&apos;s scan radius)</span>}</span>
                  <input type="range" min={300} max={2800} step={100} value={radiusM} onChange={(e) => { setRadiusM(Number(e.target.value)); setRect(null); }} className="mt-1 w-full" disabled={!step1Done} />
                </label>
                {site && <TerritoryReadout readiness={readiness} loading={readyLoading} />}
              </Step>

              <Step n={3} title="Show places on the map" done={areas.length > 0} disabled={!step2Done}>
                <p className="field-help">Places BSA already has appear first (faded). OpenStreetMap is then asked one layer at a time for anything new — <strong>nothing is saved yet</strong>.</p>
                <fieldset className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2" disabled={!step2Done}>
                  <legend className="sr-only">Also load</legend>
                  {BASE_LAYERS.filter((l) => CONTEXT_LAYERS.includes(l.key as BaseLayerKey)).map((l) => (
                    <label key={l.key} className="flex items-start gap-2 text-label" title={l.hint}>
                      <input type="checkbox" className="mt-1" checked={extras.includes(l.key as BaseLayerKey)}
                        onChange={(e) => setExtras((xs) => e.target.checked ? [...xs, l.key as BaseLayerKey] : xs.filter((x) => x !== l.key))} />
                      <span>{l.label}</span>
                    </label>
                  ))}
                </fieldset>
                <label className="mt-3 flex items-start gap-2 text-label text-ink-muted">
                  <input type="checkbox" className="mt-1" checked={refresh} onChange={(e) => setRefresh(e.target.checked)} disabled={!step2Done} />
                  <span>Check OpenStreetMap again even where this area was captured in the last 90 days</span>
                </label>
                {area && <p className={`mt-3 text-label font-normal ${tooBig ? 'text-nogo' : 'text-ink-muted'}`}>{tooBig ? '✕ ' : ''}Area ≈ {km2.toFixed(1)} km² · {layers.length} layer{layers.length === 1 ? '' : 's'}{tooBig ? ` — over the ${MAX_CAPTURE_KM2} km² limit. Make the ring smaller.` : ''}</p>}
                <button type="button" className="btn-primary mt-3 w-full" disabled={!step2Done || !area || tooBig || !layers.length || !!busy} onClick={showOnMap}>
                  {busy ?? (areas.length ? 'Add this area to the map' : 'Show places on the map')}
                </button>
                <details className="mt-3">
                  <summary className="cursor-pointer text-label text-ink-muted">Advanced: draw a rectangle instead of the ring</summary>
                  <div className="mt-2 flex items-center gap-2">
                    <button type="button" className="btn-secondary min-h-[36px] px-3 text-label" onClick={() => setMode('rect')} disabled={!step2Done}>{mode === 'rect' ? 'Click two corners…' : 'Draw rectangle'}</button>
                    {rect && <button type="button" className="link text-label" onClick={() => setRect(null)}>Use the ring again</button>}
                  </div>
                </details>
              </Step>
            </>
          )}

          {tab === 'import' && (
            <section className="card p-5">
              <h2 className="font-body text-title">Import a Grid Navigator session</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-label font-normal text-ink-muted">
                <li>In Grid Navigator, choose <em>Save session file</em> <strong>without</strong> map tiles.</li>
                <li>Pick the <code>.gridnav.json</code> file below (10 MB max). Its places appear <strong>on the map only</strong>; places BSA already has are left out.</li>
                <li>Review them, then press <strong>Save</strong>. File places are saved as Assumed.</li>
              </ol>
              <input type="file" accept=".json,application/json" className="mt-4 block w-full text-label text-ink-muted" disabled={!!busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
            </section>
          )}

          {tab === 'history' && (
            <section className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-body text-title">Saved captures</h2>
                <label className="flex items-center gap-2 text-label text-ink-muted">
                  <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} /> Show saved areas
                </label>
              </div>
              <ul className="mt-3 max-h-[360px] space-y-1 overflow-y-auto">
                {batches.length === 0 && <li className="text-label text-ink-muted">Nothing saved yet.</li>}
                {batches.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => openBatch(b.id)} className="nav-item w-full text-left">
                      <span className="min-w-0 flex-1 truncate">{b.label}</span>
                      <span className="shrink-0 text-label font-normal text-ink-muted">✓ {b.committedCount}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {regionTotals.length > 0 && (
                <table className="mt-4 w-full text-label">
                  <caption className="sr-only">Places in BSA by region</caption>
                  <thead><tr className="text-ink-muted"><th className="text-left font-normal">Region</th><th className="text-right font-normal">Places</th><th className="text-right font-normal">With barangay</th></tr></thead>
                  <tbody>
                    {regionTotals.map((r) => (
                      <tr key={r.region ?? 'none'}><td>{REGIONS.find((x) => x.key === r.region)?.name ?? r.region ?? 'Other / unassigned'}</td><td className="text-right">{r.total.toLocaleString('en-US')}</td><td className="text-right">{r.tagged.toLocaleString('en-US')}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {msg && <p role="status" className={`card-inset p-3 text-label font-normal ${msg.tone === 'err' ? 'text-nogo' : 'text-ink-text'}`}>{msg.tone === 'err' ? '✕ ' : '✓ '}{msg.text}</p>}
          {pin && <PinForm pin={pin} busy={!!busy} onCancel={() => { setPin(null); setMode('none'); }} onSave={addPin} />}
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="relative h-[62vh] min-h-[440px] overflow-hidden rounded-card border border-ink-border xl:sticky xl:top-4">
            <div ref={mapEl} className="absolute inset-0 h-full w-full" aria-label="Capture map" role="application" />
            {mode !== 'none' && (
              <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink-panel/95 px-4 py-1.5 text-label text-ink-text shadow-e1">
                {mode === 'site' ? 'Click the map to place the site pin' : mode === 'add' ? 'Click where the missing place is' : rectStart.current ? 'Click the opposite corner' : 'Click the first corner'}
              </p>
            )}
            {busy && <p className="absolute left-1/2 top-14 -translate-x-1/2 rounded-full bg-ink-panel px-4 py-2 text-label text-ink-text shadow-e1" aria-live="polite">{busy}</p>}
            {editableAreas.length > 0 && (
              <div className="absolute right-14 top-3 rounded-control bg-ink-panel/95 px-3 py-2 text-label text-ink-text shadow-e1">
                <strong>Not saved yet</strong> · {acceptedItems.length} new to save{pendingItems.length ? ` · ${pendingItems.length} need a decision` : ''}
              </div>
            )}
            <details className="absolute bottom-3 left-3 rounded-control bg-ink-panel/90 px-3 py-2 text-[12px] leading-5 text-ink-text shadow-e1" open>
              <summary className="cursor-pointer font-semibold">Legend</summary>
              <ul className="mt-1 space-y-0.5">
                <li className="flex items-center gap-2"><span className="inline-flex w-4 justify-center"><span className="inline-block h-3 w-3 -rotate-45 rounded-full rounded-bl-none border border-ink-bg bg-accent" /></span> Site pin · solid ring = catchment</li>
                <li className="flex items-center gap-2"><span className="inline-flex w-4 justify-center"><span className="inline-block h-2.5 w-2.5 rotate-45 border border-ink-bg bg-nogo" /></span> Direct competitor (counted)</li>
                <li className="flex items-center gap-2"><span className="inline-flex w-4 justify-center"><span className="inline-block h-2.5 w-2.5 border border-ink-bg bg-caution" /></span> Adjacent format (counted at 35%)</li>
                <li className="flex items-center gap-2"><span className="inline-flex w-4 justify-center"><span className="mk-other" /></span> Other business (not counted)</li>
                <li className="flex items-center gap-2"><span className="inline-flex w-4 justify-center"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-accent-soft" /></span> Context place</li>
                <li className="text-ink-muted">Faded = already saved in BSA (or skipped)</li>
                <li className="text-ink-muted">Green outline = captured area · amber ring = needs a decision</li>
              </ul>
            </details>
          </div>
        </div>
      </div>

      {status && <SaveStatus status={status} onNew={startOver} onHistory={() => setTab('history')} />}

      {areas.length > 0 && (
        <section id="cap-results" className="card scroll-mt-4 p-5" aria-labelledby="cap-results-h">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="overline">Step 4 · results</p>
              <h2 id="cap-results-h" className="font-body text-title">Captured areas</h2>
              <p className="mt-1 text-label font-normal text-ink-muted">Places already in BSA are counted but never saved again. Only new places below are saved.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {editableAreas.length > 0 && <button type="button" className="btn-secondary" onClick={() => { setMode('add'); setTab('capture'); }} disabled={!!busy}>+ Add a missing place</button>}
              <button type="button" className="btn-secondary" onClick={startOver} disabled={!!busy}>Clear all</button>
              {editableAreas.length > 0 && (!confirmSave
                ? <button type="button" className="btn-primary" disabled={pendingItems.length > 0 || loading || !!busy} onClick={() => setConfirmSave(true)}>Save {acceptedItems.length} new place{acceptedItems.length === 1 ? '' : 's'} to BSA</button>
                : <span className="flex items-center gap-2"><span className="text-label">Every broker&apos;s analysis will use these places. Save?</span><button type="button" className="btn-primary" onClick={saveAll} disabled={!!busy}>{busy ?? 'Yes, save'}</button><button type="button" className="btn-secondary" onClick={() => setConfirmSave(false)}>Cancel</button></span>)}
            </div>
          </div>
          {pendingItems.length > 0 && <p className="mt-3 text-label font-normal text-caution">▲ {pendingItems.length} place(s) need a decision before you can save — they look like places already in BSA, or are pins without a category. They are listed first.</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-label">
              <caption className="sr-only">Captured areas</caption>
              <thead className="text-ink-muted"><tr>
                <th className="py-2 text-left font-normal">Area</th><th className="text-left font-normal">Layers</th>
                <th className="text-right font-normal">Already in BSA</th><th className="text-right font-normal">New found</th><th className="text-right font-normal">To save</th><th className="text-left font-normal pl-3">Status</th><th />
              </tr></thead>
              <tbody>
                {areas.map((a) => {
                  const mine = items.filter((i) => i.areaId === a.id);
                  const toSave = mine.filter((i) => i.decision === 'accept').length;
                  const inBsa = a.stored.length;
                  return (
                    <tr key={a.id} className="border-t border-ink-border align-top">
                      <td className="py-2 pr-2">
                        <button type="button" className="text-left text-ink-text hover:underline" onClick={() => { setAreaFilter(a.id); if (a.area) fitToPoints(a.area.kind === 'circle' ? [{ lat: a.area.lat - a.area.radiusM / 111_320, lon: a.area.lon - a.area.radiusM / 108_000 }, { lat: a.area.lat + a.area.radiusM / 111_320, lon: a.area.lon + a.area.radiusM / 108_000 }] : [{ lat: a.area.south, lon: a.area.west }, { lat: a.area.north, lon: a.area.east }]); }}>{a.label}</button>
                        {a.notes.length > 0 && <div className="font-normal text-ink-muted">{a.notes.join(' ')}</div>}
                      </td>
                      <td className="pr-2">
                        <ul className="flex flex-wrap gap-1">
                          {a.layers.map((l) => (
                            <li key={l.layer} title={l.message} className={`rounded-full border px-2 py-0.5 text-[12px] ${l.status === 'failed' ? 'border-nogo text-nogo' : l.status === 'loaded' ? 'border-go text-go' : l.status === 'covered' ? 'border-ink-border text-ink-muted' : 'border-ink-border text-ink-muted'}`}>
                              {l.status === 'loading' ? '… ' : l.status === 'waiting' ? '· ' : l.status === 'failed' ? '✕ ' : '✓ '}{LAYER_LABEL[l.layer] ?? l.layer}
                              {l.status === 'loaded' && ` ${l.newCount} new`}{l.status === 'covered' && ' (saved)'}
                              {l.status === 'failed' && !a.saved && <button type="button" className="link ml-1" onClick={() => retryLayer(a, l.layer)} disabled={!!busy}>retry</button>}
                            </li>
                          ))}
                          {!a.layers.length && <li className="text-ink-muted">{a.source === 'navigator_import' ? 'From file' : a.source === 'manual' ? 'Hand-placed' : '—'}</li>}
                        </ul>
                      </td>
                      <td className="text-right">{inBsa.toLocaleString('en-US')}</td>
                      <td className="text-right">{mine.length.toLocaleString('en-US')}</td>
                      <td className="text-right">{a.saved ? '—' : toSave.toLocaleString('en-US')}</td>
                      <td className="pl-3">{a.readOnly ? 'Saved earlier' : a.saved ? <span className="text-go">✓ Saved {a.saved.saved}</span> : a.saveError ? <span className="text-nogo">✕ {a.saveError}</span> : a.layers.some((l) => l.status === 'loading' || l.status === 'waiting') ? 'Loading…' : 'Ready to save'}</td>
                      <td className="text-right"><button type="button" className="link" onClick={() => removeArea(a)} disabled={!!busy} aria-label={`Remove ${a.label}`}>Remove</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2" role="group" aria-label="Show">
            <select aria-label="Area" className="field min-h-[36px] w-auto" value={areaFilter} onChange={(e) => { setAreaFilter(e.target.value); setShown(PAGE); }}>
              <option value="all">All areas</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
            {([
              ['all', 'All'], ['pending', `Needs decision (${counts.pending})`], ['direct', `◆ Direct (${counts.direct})`],
              ['adjacent', `■ Adjacent (${counts.adjacent})`], ['unrelated', `● Other businesses (${counts.unrelated})`], ['context', `○ Context (${counts.context})`],
            ] as Array<[typeof group, string]>).map(([g, l]) => (
              <button key={g} type="button" aria-pressed={group === g} onClick={() => { setGroup(g); setShown(PAGE); }}
                className={`rounded-full border px-3 py-1 text-label ${group === g ? 'border-accent-soft bg-ink-hover text-ink-text' : 'border-ink-border text-ink-muted'}`}>{l}</button>
            ))}
            <input aria-label="Search names" className="field ml-auto min-h-[36px] w-48" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {visible.some((i) => !areaById.get(i.areaId)?.saved && !areaById.get(i.areaId)?.readOnly) && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="link text-label" onClick={() => updateItems(visible.map((i) => i.key), { decision: 'accept' })}>Save all shown</button>
              <span className="text-ink-muted">·</span>
              <button type="button" className="link text-label" onClick={() => updateItems(visible.map((i) => i.key), { decision: 'reject' })}>Skip all shown</button>
            </div>
          )}

          <div className="mt-3 max-h-[520px] overflow-auto">
            <table className="w-full text-label">
              <caption className="sr-only">New places found</caption>
              <thead className="sticky top-0 z-10 bg-ink-panel text-ink-muted">
                <tr><th className="py-2 text-left font-normal">Place</th><th className="text-left font-normal">Territory Guard</th><th className="text-left font-normal">Category</th><th className="text-left font-normal">Truth</th><th className="text-left font-normal">Status</th><th className="text-left font-normal">Decision</th></tr>
              </thead>
              <tbody>
                {visible.slice(0, shown).map((it) => {
                  const a = areaById.get(it.areaId);
                  const editable = !!a && !a.saved && !a.readOnly;
                  const s = a?.context?.site;
                  const d = s ? Math.round(distanceM(s.lat, s.lon, it.lat, it.lon)) : null;
                  const inCatch = d != null && d <= catchmentFor(a?.context?.format);
                  const renamed = it.name !== it.originalName;
                  return (
                    <tr key={it.key} id={`cap-row-${cssId(it.key)}`} className={`border-t border-ink-border align-top ${selected === it.key ? 'bg-ink-hover' : ''}`}>
                      <td className="py-2 pr-2">
                        {editable
                          ? <input aria-label="Place name" className="w-full rounded-control border border-transparent bg-transparent px-1 text-ink-text hover:border-ink-border focus:border-accent-soft" value={it.name} maxLength={200}
                              onFocus={() => { setSelected(it.key); flyTo(it.lat, it.lon, 17); }} onChange={(e) => updateItems([it.key], { name: e.target.value })} />
                          : <button type="button" className="text-left text-ink-text hover:underline" onClick={() => { setSelected(it.key); flyTo(it.lat, it.lon, 17); }}>{it.name}</button>}
                        <div className="px-1 font-normal text-ink-muted">{it.kind ?? 'added by hand'}{d != null ? ` · ${d.toLocaleString('en-US')} m from site${inCatch ? ' (in catchment)' : ''}` : ''}{it.notes ? ` · ${it.notes}` : ''}{renamed ? ' · renamed → saves as Assumed' : ''}</div>
                      </td>
                      <td className="pr-2"><span className={it.tier === 'direct' ? 'text-nogo' : it.tier === 'adjacent' ? 'text-caution' : 'text-ink-muted'}>{TIER_META[it.tier].glyph} {TIER_META[it.tier].short}</span></td>
                      <td className="pr-2">
                        {editable
                          ? <select aria-label={`Category for ${it.name}`} className="rounded-control border border-ink-border-strong bg-ink-panel-2 px-2 py-1" value={it.category} onChange={(e) => updateItems([it.key], { category: e.target.value as BsaPoiCategory, ...(it.needsReview && it.decision === 'pending' && !it.duplicateOf ? { decision: 'accept' as const } : {}) })}>
                              {BSA_POI_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                            </select>
                          : CATEGORY_LABEL[it.category]}
                      </td>
                      <td className="pr-2"><TruthChip layer={renamed ? 'assumed' : it.truthLayer} compact /></td>
                      <td className="pr-2 text-ink-muted">{a?.saved || a?.readOnly ? '✓ in BSA' : it.duplicateOf ? `▲ looks like “${it.duplicateOf.name}”` : 'new'}</td>
                      <td>
                        {editable ? (
                          <div role="radiogroup" aria-label={`Decision for ${it.name}`} className="flex gap-1">
                            {(['accept', 'reject'] as const).map((dc) => (
                              <button key={dc} type="button" role="radio" aria-checked={it.decision === dc} onClick={() => updateItems([it.key], { decision: dc })}
                                className={`rounded-control border px-2 py-1 ${it.decision === dc ? (dc === 'accept' ? 'border-go text-go' : 'border-nogo text-nogo') : 'border-ink-border text-ink-muted'}`}>
                                {dc === 'accept' ? '✓ Save' : '✕ Skip'}
                              </button>
                            ))}
                          </div>
                        ) : <span className="text-ink-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length > shown && <button type="button" className="btn-secondary mt-3" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}</button>}
            {visible.length === 0 && <p className="py-4 text-label text-ink-muted">{loading ? 'Loading…' : 'No new places here — everything found is already in BSA.'}</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function cssId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Status screen after Save — one row per area, totals, and Territory Guard before → after. */
function SaveStatus({ status, onNew, onHistory }: { status: { at: string; areas: AreaRun[] }; onNew: () => void; onHistory: () => void }) {
  const ok = status.areas.filter((a) => a.saved);
  const failed = status.areas.filter((a) => a.saveError);
  const tot = ok.reduce((t, a) => ({ saved: t.saved + a.saved!.saved, already: t.already + a.saved!.alreadyInBsa + a.stored.length, tagged: t.tagged + a.saved!.psgcTagged, cells: t.cells + a.saved!.coverageStamped }), { saved: 0, already: 0, tagged: 0, cells: 0 });
  return (
    <section id="cap-status" className="card scroll-mt-4 overflow-hidden" aria-labelledby="cap-status-h" role="status">
      <div className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${failed.length ? 'bg-caution/15' : 'bg-go/15'}`}>
        <div>
          <p className="overline">Save complete · {status.at}</p>
          <h2 id="cap-status-h" className="font-body text-title">{failed.length ? `▲ Saved ${ok.length} of ${status.areas.length} areas` : `✓ Saved to BSA — ${tot.saved.toLocaleString('en-US')} new place${tot.saved === 1 ? '' : 's'}`}</h2>
        </div>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" onClick={onHistory}>Saved captures</button>
          <button type="button" className="btn-primary" onClick={onNew}>Start a new capture</button>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-3 px-5 py-4 text-center sm:grid-cols-4">
        <div><dt className="stat-label">New places saved</dt><dd className="text-h3">{tot.saved.toLocaleString('en-US')}</dd></div>
        <div><dt className="stat-label">Already in BSA (not re-saved)</dt><dd className="text-h3">{tot.already.toLocaleString('en-US')}</dd></div>
        <div><dt className="stat-label">Tagged with barangay</dt><dd className="text-h3">{tot.tagged.toLocaleString('en-US')}</dd></div>
        <div><dt className="stat-label">Map cells marked captured</dt><dd className="text-h3">{tot.cells.toLocaleString('en-US')}</dd></div>
      </dl>
      <table className="w-full border-t border-ink-border text-label">
        <caption className="sr-only">Save result per area</caption>
        <thead className="text-ink-muted"><tr><th className="px-5 py-2 text-left font-normal">Area</th><th className="text-right font-normal">Saved</th><th className="text-right font-normal">Already in BSA</th><th className="px-5 text-left font-normal">Territory Guard — direct competitors in catchment</th></tr></thead>
        <tbody>
          {status.areas.map((a) => (
            <tr key={a.id} className="border-t border-ink-border align-top">
              <td className="px-5 py-2">{a.saveError ? <span className="text-nogo">✕ </span> : <span className="text-go">✓ </span>}{a.label}{a.saveError && <div className="text-nogo">{a.saveError} — the places are still on the map; press Save again.</div>}</td>
              <td className="text-right">{a.saved ? a.saved.saved : '—'}</td>
              <td className="text-right">{a.saved ? a.saved.alreadyInBsa + a.stored.length : '—'}</td>
              <td className="px-5">
                {a.after?.length ? a.after.map((v) => {
                  const b = a.before?.find((x) => x.vertical === v.vertical);
                  return <div key={v.vertical}>{CAPTURE_VERTICALS.find((x) => x.key === v.vertical)?.label ?? v.concept?.label ?? v.vertical}: {b ? `${b.summary.catchment.direct} → ` : ''}<strong>{v.summary.catchment.direct}</strong> · saturation {Math.round(v.summary.saturationPct)}%</div>;
                }) : <span className="text-ink-muted">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** "What Territory Guard sees here now" — per chosen business type, inside the catchment. */
function TerritoryReadout({ readiness, loading }: { readiness: Readiness | null; loading: boolean }) {
  if (!readiness) return <p className="mt-3 text-label text-ink-muted">{loading ? 'Checking what BSA already holds here…' : ''}</p>;
  return (
    <div className="card-inset mt-4 p-3" aria-live="polite">
      <p className="overline">Territory Guard sees here now{loading ? ' · updating…' : ''}</p>
      <p className="mt-1 text-label font-normal text-ink-muted">{readiness.places.length.toLocaleString('en-US')} places already in BSA inside the ring.</p>
      {readiness.byVertical.length > 0 && (
        <table className="mt-2 w-full text-label">
          <thead className="text-ink-muted"><tr><th className="text-left font-normal">Business type</th><th className="text-right font-normal">◆ Direct</th><th className="text-right font-normal">■ Adj.</th><th className="text-right font-normal">Sat.</th></tr></thead>
          <tbody>
            {readiness.byVertical.map((v) => (
              <tr key={v.vertical} className="border-t border-ink-border">
                <td className="py-1">{CAPTURE_VERTICALS.find((x) => x.key === v.vertical)?.label ?? v.vertical}</td>
                <td className="text-right">{v.summary.catchment.direct}</td>
                <td className="text-right">{v.summary.catchment.adjacent}</td>
                <td className="text-right">{Math.round(v.summary.saturationPct)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-2 text-label font-normal text-ink-muted">Counted inside the {readiness.catchmentM.toLocaleString('en-US')} m catchment with Territory Guard&apos;s own rules. Saturation is Projected.</p>
      {readiness.coverage.length > 0 && <p className="mt-1 text-label font-normal text-ink-muted">Already captured: {readiness.coverage.map((c) => `${CAPTURE_VERTICALS.find((x) => x.key === c.vertical)?.label ?? c.vertical} ${c.fresh}/${c.cells} cells`).join(' · ')}</p>}
    </div>
  );
}

function Step({ n, title, done, disabled, children }: { n: number; title: string; done?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <section className={`card p-5 ${disabled ? 'opacity-60' : ''}`} aria-labelledby={`cap-step-${n}`} aria-disabled={disabled || undefined}>
      <h2 id={`cap-step-${n}`} className="flex items-center gap-2 font-body text-title">
        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-label ${done ? 'bg-go text-on-status' : 'border border-ink-border-strong text-ink-muted'}`} aria-hidden>{done ? '✓' : n}</span>
        {title}{done && <span className="sr-only"> (done)</span>}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function PinForm({ pin, busy, onCancel, onSave }: { pin: { lat: number; lon: number }; busy: boolean; onCancel: () => void; onSave: (f: { name: string; category: BsaPoiCategory; notes: string }) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<BsaPoiCategory>('competitor');
  const [notes, setNotes] = useState('');
  return (
    <section className="card p-5" aria-labelledby="cap-pin">
      <h2 id="cap-pin" className="font-body text-title">Add a missing place</h2>
      <p className="field-help mt-1">At {pin.lat.toFixed(6)}, {pin.lon.toFixed(6)}. Saved as <strong>Assumed</strong> until an admin confirms it on the ground. Choose “Business” for a store so Territory Guard can count it.</p>
      <label className="mt-3 block"><span className="field-label">Name (as on the signboard)</span><input className="field mt-1" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="mt-3 block"><span className="field-label">Category</span>
        <select className="field mt-1" value={category} onChange={(e) => setCategory(e.target.value as BsaPoiCategory)}>
          {BSA_POI_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
      </label>
      <label className="mt-3 block"><span className="field-label">Notes (optional)</span><input className="field mt-1" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary" disabled={!name.trim() || busy} onClick={() => onSave({ name: name.trim(), category, notes: notes.trim() })}>Put it on the map</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
