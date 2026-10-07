'use client';

/**
 * Admin Place Capture — grid-navigator's capture loop, aligned to Territory Guard (2026-10-07).
 *
 *   1 · Drop the site pin      → coordinate + PSGC barangay/city/province it falls in
 *   2 · Business & catchment   → same catchment rings, tiers and saturation Territory Guard uses,
 *                                with a live "what Territory Guard sees here now" read-out
 *   3 · Show on the map        → pull the ring from OpenStreetMap (server-side, READ-ONLY) and draw it
 *   4 · Review & save          → everything stays in the browser while the admin reviews; only
 *                                "Save to BSA" writes — `poi`, PSGC tags, Territory Guard coverage, audit
 *
 * The browser never calls OpenStreetMap or the database: everything goes through the admin-only
 * /api/admin/capture/* routes. If the admin leaves before saving, nothing was written.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { defaultBasemapUrl, basemapPaint, OSM_ATTRIBUTION, OSM_MAX_ZOOM } from '@/lib/ui/theme';
import { listRegions } from '@/lib/geo/regions';
import { geoCircle } from '@/lib/geo/mapGeometry';
import { BASE_LAYERS, type BaseLayerKey, type LayerKey } from '@/lib/capture/layers';
import { areaGeoJson, areaKm2, distanceM, MAX_CAPTURE_KM2, type CaptureArea } from '@/lib/capture/area';
import {
  CAPTURE_VERTICALS, SITE_FORMATS, DEFAULT_SCAN_M, catchmentFor, conceptForSite, layersForSite,
  parseLatLon, summariseForTerritory, tierOfPlace, type PlaceTier, type SiteFormat, type TerritorySummary,
} from '@/lib/capture/territoryAlign';
import { BSA_POI_CATEGORIES, CATEGORY_LABEL, type BsaPoiCategory } from '@/lib/places/osmCategory';
import { markerElement } from '@/components/MapMarkers';
import { TruthChip } from '@/components/ui/Chips';

type Decision = 'accept' | 'reject' | 'pending';
type MapMode = 'site' | 'rect' | 'add' | 'none';
type Tab = 'capture' | 'import' | 'history';

interface BatchSummary {
  id: string; label: string; source: string; itemCount: number; committedCount: number; createdAt: string; createdBy: string | null;
}
interface SiteContext { site?: { lat: number; lon: number }; vertical?: string; brand?: string; format?: SiteFormat }
/** A place returned by /preview or /import (nothing stored yet). */
interface Candidate {
  key: string; osmRef: string | null; name: string; kind: string | null; category: BsaPoiCategory;
  lat: number; lon: number; origin: 'osm' | 'file' | 'manual'; truthLayer: 'verified' | 'assumed';
  receipt?: string; existingPoiId: string | null; duplicateOf: { id: string; name: string } | null;
  needsReview?: boolean; notes?: string | null;
}
/** A place under review in the browser. */
interface ReviewItem extends Candidate { decision: Decision; originalName: string }
/** The working set shown on the map — lives only in the browser until saved. */
interface Review {
  source: 'osm' | 'navigator_import' | 'manual';
  label: string;
  area?: CaptureArea;
  layers?: LayerKey[];
  context?: SiteContext;
  notes: string[];
  items: ReviewItem[];
  saved?: { batchId: string; saved: number; inBsa: number; psgcTagged: number; skippedExisting: number; coverageStamped: number };
  /** A saved batch opened from History (read-only). */
  readOnly?: boolean;
}
interface SavedBatch {
  batch: BatchSummary & { notes: string | null; areaSpec: (CaptureArea & { context?: SiteContext | null }) | null; layers: string[] };
  items: Array<{ key: string; osmRef: string | null; name: string; kind: string | null; category: BsaPoiCategory; lat: number; lon: number; truthLayer: 'verified' | 'assumed' | 'projected'; committedPoiId: string | null; notes: string | null }>;
}
interface Readiness {
  boundary: { psgcCode: string; barangay: string | null; city: string | null; province: string | null; region: string | null } | null;
  region: string | null;
  catchmentM: number;
  radiusM: number;
  concept: { key: string; label: string } | null;
  summary: TerritorySummary;
  coverage: { cells: number; fresh: number } | null;
  places: Array<{ id: string; name: string; category: string; lat: number; lon: number; distM: number; tier: PlaceTier }>;
  capped: boolean;
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
    // Non-JSON (e.g. a platform timeout page) — say what happened instead of a generic error.
    return { ok: false, error: { code: `http_${res.status}`, message: `The server answered ${res.status}${res.status === 504 || res.status === 502 ? ' (it took too long — try a smaller ring)' : ''}. Nothing was saved.` } };
  }
}

/** Initial review decision for a place from the server. */
function initialDecision(c: Candidate): Decision {
  if (c.origin === 'file' && c.existingPoiId) return 'reject'; // imports never overwrite stored places
  if (c.duplicateOf || c.needsReview) return 'pending';
  return 'accept';
}
const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
});

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
  // Step 2 — business & catchment
  const [vertical, setVertical] = useState('');
  const [brand, setBrand] = useState('');
  const [format, setFormat] = useState<SiteFormat>('inline');
  const [radiusM, setRadiusM] = useState(DEFAULT_SCAN_M);
  const [extras, setExtras] = useState<BaseLayerKey[]>(['anchors', 'transport', 'health', 'education']);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [readyLoading, setReadyLoading] = useState(false);
  // Advanced: rectangle instead of the ring
  const [rect, setRect] = useState<CaptureArea | null>(null);
  const rectStart = useRef<{ lat: number; lon: number } | null>(null);
  // Review (browser-only until saved)
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [before, setBefore] = useState<TerritorySummary | null>(null);
  const [after, setAfter] = useState<TerritorySummary | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [group, setGroup] = useState<'all' | PlaceTier | 'pending' | 'existing'>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [showCoverage, setShowCoverage] = useState(true);
  const [regionTotals, setRegionTotals] = useState<Array<{ region: string | null; total: number; tagged: number }>>([]);

  useEffect(() => { modeRef.current = mode; if (mode !== 'rect') rectStart.current = null; }, [mode]);

  const unsaved = !!review && !review.saved && !review.readOnly && review.items.some((i) => i.decision === 'accept');
  // Warn before leaving with places that were shown but not saved.
  useEffect(() => {
    if (!unsaved) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [unsaved]);

  const catchmentM = catchmentFor(format);
  const ctx = review?.context;
  const concept = useMemo(() => conceptForSite(ctx?.vertical ?? vertical, ctx?.brand ?? brand), [ctx, vertical, brand]);
  const area: CaptureArea | null = rect ?? (site ? { kind: 'circle', lat: site.lat, lon: site.lon, radiusM } : null);
  const km2 = area ? areaKm2(area) : 0;
  const tooBig = km2 > MAX_CAPTURE_KM2;
  const layers = layersForSite(vertical, extras);

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

  const fetchReadiness = useCallback(async (s: { lat: number; lon: number }) => {
    setReadyLoading(true);
    const q = new URLSearchParams({ lat: String(s.lat), lon: String(s.lon), radiusM: String(radiusM), format, vertical, brand: brand.trim() });
    const r = await api<Readiness>(`/api/admin/capture/readiness?${q.toString()}`);
    setReadyLoading(false);
    if (r.ok) { setReadiness(r.data); return r.data; }
    setMsg({ tone: 'err', text: r.error.message });
    return null;
  }, [radiusM, format, vertical, brand]);

  useEffect(() => {
    if (!site) { setReadiness(null); return; }
    const t = setTimeout(() => { void fetchReadiness(site); }, 350);
    return () => clearTimeout(t);
  }, [site, fetchReadiness]);

  /* ---------------------------------------------------------------- map */

  const placeSite = useCallback((lat: number, lon: number, fly = false) => {
    const p = { lat: round6(lat), lon: round6(lon) };
    setSite(p);
    setRect(null);
    setAfter(null);
    const map = mapRef.current;
    if (!map) return;
    if (!siteMarker.current) {
      siteMarker.current = new maplibregl.Marker({ element: markerElement('site', 'Site pin — drag to adjust'), draggable: true, anchor: 'bottom' })
        .setLngLat([p.lon, p.lat]).addTo(map);
      siteMarker.current.on('dragend', () => {
        const ll = siteMarker.current!.getLngLat();
        setSite({ lat: round6(ll.lat), lon: round6(ll.lng) });
        setAfter(null);
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
        for (const id of ['coverage', 'catchment', 'scan', 'rect', 'existing', 'items']) map.addSource(id, { type: 'geojson', data: EMPTY_FC });
        map.addLayer({ id: 'coverage-fill', type: 'fill', source: 'coverage', paint: { 'fill-color': token('--projected', '#B39AE8'), 'fill-opacity': 0.07 } });
        map.addLayer({ id: 'coverage-line', type: 'line', source: 'coverage', paint: { 'line-color': token('--projected', '#B39AE8'), 'line-width': 1, 'line-dasharray': [2, 2] } });
        map.addLayer({ id: 'scan-line', type: 'line', source: 'scan', paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [3, 2] } });
        map.addLayer({ id: 'rect-fill', type: 'fill', source: 'rect', paint: { 'fill-color': accent, 'fill-opacity': 0.08 } });
        map.addLayer({ id: 'rect-line', type: 'line', source: 'rect', paint: { 'line-color': accent, 'line-width': 2 } });
        map.addLayer({ id: 'catchment-fill', type: 'fill', source: 'catchment', paint: { 'fill-color': accent, 'fill-opacity': 0.12 } });
        map.addLayer({ id: 'catchment-line', type: 'line', source: 'catchment', paint: { 'line-color': accent, 'line-width': 2 } });
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
      map.on('click', 'items-icons', (e) => {
        const key = e.features?.[0]?.properties?.key;
        if (key && modeRef.current === 'none') setSelected(String(key));
      });
      map.on('click', 'existing-icons', (e) => {
        if (modeRef.current !== 'none') return;
        const f = e.features?.[0];
        if (f) new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat).setText(`${f.properties?.name} — already in BSA (${f.properties?.tierLabel})`).addTo(map);
      });
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
    const set = (id: string, data: GeoJSON.Feature | typeof EMPTY_FC) => (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    set('catchment', site ? geoCircle(site.lon, site.lat, catchmentM) as GeoJSON.Feature : EMPTY_FC);
    set('scan', site && !rect ? geoCircle(site.lon, site.lat, radiusM) as GeoJSON.Feature : EMPTY_FC);
    set('rect', rect ? { type: 'Feature', properties: {}, geometry: areaGeoJson(rect) } : EMPTY_FC);
  }, [site, catchmentM, radiusM, rect, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    const src = mapRef.current?.getSource('existing') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: (readiness?.places ?? []).map((p) => ({
        type: 'Feature',
        properties: { name: p.name, icon: `ic-${p.tier}`, rank: TIER_META[p.tier].rank, tierLabel: TIER_META[p.tier].label },
        geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      })),
    });
  }, [readiness, mapReady]);

  const tiered = useMemo(() => (review?.items ?? []).map((it) => ({ ...it, tier: tierOfPlace(it, concept) })), [review, concept]);
  const reviewSite = ctx?.site ?? site;
  useEffect(() => {
    if (!mapReady) return;
    const src = mapRef.current?.getSource('items') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
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

  useEffect(() => { if (mapReady) { void loadBatches(); void loadCoverage(); } }, [mapReady, loadBatches, loadCoverage]);

  useEffect(() => {
    if (selected) document.getElementById(`cap-row-${cssId(selected)}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  /* ---------------------------------------------------------------- actions */

  function confirmDropUnsaved(): boolean {
    return !unsaved || window.confirm('The places on the map have not been saved. Discard them?');
  }

  function goToCoords() {
    const p = parseLatLon(coordText);
    if (!p) { setCoordErr('Use “latitude, longitude” inside the Philippines, e.g. 14.2846, 121.0966'); return; }
    setCoordErr(null);
    placeSite(p.lat, p.lon, true);
    setMode('none');
  }

  function fitToItems(items: Array<{ lat: number; lon: number }>) {
    if (!items.length || !mapRef.current) return;
    let s = 90, w = 180, n = -90, e = -180;
    for (const p of items) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); }
    mapRef.current.fitBounds([[w, s], [e, n]], { padding: 48, maxZoom: 16, duration: 600 });
  }

  /** Step 3: fetch from OSM and DRAW ON THE MAP. Nothing is written. */
  async function showOnMap() {
    if (!area || tooBig || !layers.length || !confirmDropUnsaved()) return;
    setBusy('Loading places from OpenStreetMap…'); setMsg(null); setAfter(null); setConfirmSave(false);
    setBefore(readiness?.summary ?? null);
    const r = await api<{ candidates: Candidate[]; notes: string[]; skipped: Record<string, number> }>('/api/admin/capture/preview', jsonInit('POST', { area, layers }));
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    const label = [CAPTURE_VERTICALS.find((v) => v.key === vertical)?.label, brand.trim(), readiness?.boundary?.city ?? readiness?.boundary?.barangay].filter(Boolean).join(' · ') || 'OSM capture';
    setReview({
      source: 'osm', label, area, layers,
      context: { site: site ?? undefined, vertical: vertical || undefined, brand: brand.trim() || undefined, format },
      notes: r.data.notes,
      items: r.data.candidates.map((c) => ({ ...c, decision: initialDecision(c), originalName: c.name })),
    });
    setGroup('all'); setShown(PAGE); setSelected(null);
    setMsg({ tone: 'ok', text: r.data.candidates.length
      ? `${r.data.candidates.length} places are now on the map. Nothing is saved yet — review them, then press “Save to BSA”.`
      : 'OpenStreetMap has no matching places in this ring. Try a bigger ring or more layers, or add places by hand.' });
    setTimeout(() => document.getElementById('cap-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function importFile(file: File) {
    if (!confirmDropUnsaved()) return;
    if (file.size > 10 * 1024 * 1024) { setMsg({ tone: 'err', text: 'File is larger than 10 MB. In Grid Navigator, save the session without cached map tiles.' }); return; }
    setBusy('Reading the Grid Navigator session…'); setMsg(null); setAfter(null); setBefore(null);
    const text = await file.text();
    const r = await api<{ candidates: Candidate[]; notes: string[]; label: string }>('/api/admin/capture/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-file-name': file.name.replace(/[^\x20-\x7e]/g, '_').slice(0, 80) }, body: text,
    });
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    setReview({ source: 'navigator_import', label: r.data.label, notes: r.data.notes, items: r.data.candidates.map((c) => ({ ...c, decision: initialDecision(c), originalName: c.name })) });
    setGroup('all'); setShown(PAGE);
    setMsg({ tone: 'ok', text: `${r.data.candidates.length} places from the session are on the map. Review them, then press “Save to BSA”.` });
    fitToItems(r.data.candidates);
  }

  /** Hand-placed pin: added to the browser review set (saved with everything else). */
  function addPin(form: { name: string; category: BsaPoiCategory; notes: string }) {
    if (!pin) return;
    const item: ReviewItem = {
      key: `m:${Date.now()}:${pin.lat}:${pin.lon}`, osmRef: null, name: form.name, kind: null, category: form.category,
      lat: pin.lat, lon: pin.lon, origin: 'manual', truthLayer: 'assumed', existingPoiId: null, duplicateOf: null,
      notes: form.notes || null, decision: 'accept', originalName: form.name,
    };
    setReview((r) => r && !r.saved && !r.readOnly
      ? { ...r, items: [item, ...r.items] }
      : { source: 'manual', label: 'Places added by hand', notes: [], items: [item], context: site ? { site, vertical: vertical || undefined, brand: brand.trim() || undefined, format } : undefined });
    setPin(null); setMode('none');
    setMsg({ tone: 'ok', text: `“${form.name}” is on the map (Assumed). Press “Save to BSA” to keep it.` });
  }

  function updateItems(keys: string[], patch: Partial<Pick<ReviewItem, 'decision' | 'name' | 'category'>>) {
    const set = new Set(keys);
    setReview((r) => r && { ...r, items: r.items.map((it) => (set.has(it.key) ? { ...it, ...patch } : it)) });
  }

  /** Step 4: the only write. Sends the accepted places; the server re-derives trust from receipts. */
  async function save() {
    if (!review || review.saved || review.readOnly) return;
    const accepted = review.items.filter((i) => i.decision === 'accept');
    if (!accepted.length) return;
    setBefore((b) => b ?? readiness?.summary ?? null);
    setBusy(`Saving ${accepted.length} places to BSA…`); setMsg(null);
    const r = await api<NonNullable<Review['saved']>>('/api/admin/capture/save', jsonInit('POST', {
      source: review.source, label: review.label, area: review.area, layers: review.layers, context: review.context,
      items: accepted.map((i) => ({ osmRef: i.osmRef, receipt: i.receipt ?? null, name: i.name, kind: i.kind, category: i.category, lat: i.lat, lon: i.lon, origin: i.origin, notes: i.notes ?? null })),
    }));
    setBusy(null); setConfirmSave(false);
    if (!r.ok) { setMsg({ tone: 'err', text: `${r.error.message} Your places are still on the map — you can try Save again.` }); return; }
    setReview((rv) => rv && { ...rv, saved: r.data });
    const untagged = r.data.saved - r.data.psgcTagged;
    setMsg({ tone: 'ok', text: `Saved to BSA: ${r.data.saved} places written${r.data.skippedExisting ? `, ${r.data.skippedExisting} already there and left unchanged` : ''}.${untagged > 0 ? ` ${untagged} have no barangay yet (boundaries not loaded there).` : ' Every place is tagged with its barangay.'}` });
    await loadBatches(); await loadCoverage();
    if (reviewSite) {
      const fresh = await fetchReadiness(reviewSite);
      if (fresh) setAfter(fresh.summary);
    }
  }

  function clearReview() {
    if (!confirmDropUnsaved()) return;
    setReview(null); setAfter(null); setBefore(null); setConfirmSave(false);
    setMsg({ tone: 'ok', text: 'Cleared from the map. Nothing was saved.' });
  }

  async function openBatch(id: string) {
    if (!confirmDropUnsaved()) return;
    const r = await api<SavedBatch>(`/api/admin/capture/batches/${id}`);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    const b = r.data.batch;
    const c = b.areaSpec?.context ?? undefined;
    setBefore(null); setAfter(null);
    setReview({
      source: b.source as Review['source'], label: b.label, area: b.areaSpec ?? undefined, context: c, notes: b.notes ? [b.notes] : [], readOnly: true,
      items: r.data.items.map((it) => ({ ...it, origin: it.osmRef ? 'osm' : 'manual', truthLayer: it.truthLayer === 'verified' ? 'verified' : 'assumed', existingPoiId: it.committedPoiId, duplicateOf: null, decision: 'accept', originalName: it.name })),
    });
    if (c?.site) {
      placeSite(c.site.lat, c.site.lon, true);
      if (c.vertical) setVertical(c.vertical);
      if (c.brand) setBrand(c.brand);
      if (c.format) setFormat(c.format);
      if (b.areaSpec?.kind === 'circle') setRadiusM(b.areaSpec.radiusM);
      setMode('none');
    } else fitToItems(r.data.items);
  }

  function flyTo(lat: number, lon: number, zoom = 13) { mapRef.current?.flyTo({ center: [lon, lat], zoom }); }

  /* ---------------------------------------------------------------- review list */

  const counts = useMemo(() => {
    const c = { direct: 0, adjacent: 0, unrelated: 0, context: 0, pending: 0, existing: 0, accept: 0, reject: 0 };
    for (const it of tiered) {
      c[it.tier]++;
      if (it.decision === 'pending') c.pending++;
      if (it.decision === 'accept') c.accept++;
      if (it.decision === 'reject') c.reject++;
      if (it.existingPoiId) c.existing++;
    }
    return c;
  }, [tiered]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tiered
      .filter((it) => {
        if (group === 'pending') return it.decision === 'pending';
        if (group === 'existing') return !!it.existingPoiId;
        if (group !== 'all') return it.tier === group;
        return true;
      })
      .filter((it) => !q || it.name.toLowerCase().includes(q) || (it.kind ?? '').includes(q))
      .sort((a, b) => (a.decision === 'pending' ? -1 : 0) - (b.decision === 'pending' ? -1 : 0) || TIER_META[b.tier].rank - TIER_META[a.tier].rank || a.name.localeCompare(b.name));
  }, [tiered, group, search]);
  const editable = !!review && !review.saved && !review.readOnly;

  const projected = useMemo(() => {
    if (!reviewSite || !readiness || !review || !editable) return null;
    const known = new Set(tiered.filter((i) => i.existingPoiId).map((i) => i.existingPoiId));
    const existing = readiness.places.filter((p) => !known.has(p.id)).map((p) => ({ tier: p.tier, distM: p.distM }));
    const staged = tiered.filter((i) => i.decision === 'accept' || !!i.existingPoiId).map((i) => ({ tier: i.tier, distM: distanceM(reviewSite.lat, reviewSite.lon, i.lat, i.lon) }));
    return summariseForTerritory([...existing, ...staged], readiness.catchmentM);
  }, [reviewSite, readiness, review, editable, tiered]);

  const step1Done = !!site || !!rect;
  const step2Done = step1Done && !!vertical;
  const stage: 'setup' | 'onMap' | 'saved' = !review ? 'setup' : review.saved || review.readOnly ? 'saved' : 'onMap';

  /* ---------------------------------------------------------------- render */

  return (
    <div className="flex flex-col gap-5">
      <ol className="flex flex-wrap items-center gap-2 text-label" aria-label="Progress">
        {([['setup', '1–2 · Set up the site'], ['onMap', '3 · Places shown on the map'], ['saved', '4 · Saved to BSA']] as const).map(([k, l], i) => {
          const order = { setup: 0, onMap: 1, saved: 2 } as const;
          const done = order[stage] > i;
          const now = order[stage] === i;
          return (
            <li key={k} className={`rounded-full border px-3 py-1 ${now ? 'border-accent-soft bg-ink-hover text-ink-text' : done ? 'border-go text-go' : 'border-ink-border text-ink-muted'}`} aria-current={now ? 'step' : undefined}>
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
                <p className="field-help">Click the map where the site is (drag the pin to fine-tune), or paste coordinates.</p>
                <div className="mt-3 flex gap-2">
                  <select aria-label="Jump to region" className="field min-h-[40px] flex-1" defaultValue="" onChange={(e) => { const r = REGIONS.find((x) => x.key === e.target.value); if (r) flyTo(r.warmCentres[0].lat, r.warmCentres[0].lon, 12); }}>
                    <option value="" disabled>Jump to a region…</option>
                    {REGIONS.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
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
                        : readiness && <p className="text-caution">▲ No barangay boundary loaded here{readiness.region ? ` (approx. region: ${REGIONS.find((r) => r.key === readiness.region)?.name ?? readiness.region})` : ''}. Places still save with exact coordinates; load the region&apos;s boundaries to tag barangays.</p>}
                  </div>
                )}
              </Step>

              <Step n={2} title="Business & catchment" done={step2Done} disabled={!step1Done}>
                <label className="block"><span className="field-label">Business type (what Territory Guard compares against)</span>
                  <select className="field mt-1" value={vertical} onChange={(e) => setVertical(e.target.value)} disabled={!step1Done}>
                    <option value="">Choose…</option>
                    {CAPTURE_VERTICALS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                  </select>
                </label>
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
                {site && <TerritoryReadout readiness={readiness} loading={readyLoading} vertical={vertical} />}
              </Step>

              <Step n={3} title="Show places on the map" done={stage !== 'setup'} disabled={!step2Done}>
                <p className="field-help">Loads the {CAPTURE_VERTICALS.find((v) => v.key === vertical)?.label ?? 'business'} competitor set inside the ring, plus the context places below, <strong>onto the map only</strong>. Nothing is saved until step 4.</p>
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
                {area && <p className={`mt-3 text-label font-normal ${tooBig ? 'text-nogo' : 'text-ink-muted'}`}>{tooBig ? '✕ ' : ''}Area ≈ {km2.toFixed(1)} km²{tooBig ? ` — over the ${MAX_CAPTURE_KM2} km² limit. Make the ring smaller.` : ''}</p>}
                <button type="button" className="btn-primary mt-3 w-full" disabled={!step2Done || !area || tooBig || !layers.length || !!busy} onClick={showOnMap}>
                  {busy ?? (review && !review.saved && !review.readOnly ? 'Reload places on the map' : 'Show places on the map')}
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
                <li>Pick the <code>.gridnav.json</code> file below (10 MB max). Its places appear <strong>on the map only</strong>.</li>
                <li>Review them, then press <strong>Save to BSA</strong>. File places are saved as Assumed and never overwrite places BSA already has.</li>
              </ol>
              <input type="file" accept=".json,application/json" className="mt-4 block w-full text-label text-ink-muted" disabled={!!busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
              {busy && <p className="mt-2 text-label text-ink-muted">{busy}</p>}
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
                      <tr key={r.region ?? 'none'}><td>{REGIONS.find((x) => x.key === r.region)?.name ?? r.region ?? 'Unassigned'}</td><td className="text-right">{r.total.toLocaleString('en-US')}</td><td className="text-right">{r.tagged.toLocaleString('en-US')}</td></tr>
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
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center bg-ink-bg/40" aria-live="polite">
                <p className="rounded-full bg-ink-panel px-4 py-2 text-label text-ink-text shadow-e1">{busy}</p>
              </div>
            )}
            {stage === 'onMap' && review && (
              <div className="absolute right-14 top-3 rounded-control bg-ink-panel/95 px-3 py-2 text-label text-ink-text shadow-e1">
                <strong>Not saved yet</strong> · {counts.accept} to save{counts.pending ? ` · ${counts.pending} need a decision` : ''}
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
                <li className="text-ink-muted">Faded = already in BSA or skipped</li>
                <li className="text-ink-muted">Amber ring = needs a decision</li>
              </ul>
            </details>
          </div>
        </div>
      </div>

      {review && (
        <section id="cap-review" className="card scroll-mt-4 p-5" aria-labelledby="cap-review-h">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="overline">{review.readOnly ? 'Saved capture' : review.saved ? 'Step 4 · saved' : 'Step 4 · review, then save'}</p>
              <h2 id="cap-review-h" className="font-body text-title">{review.label}</h2>
              <p className="mt-1 text-label font-normal text-ink-muted">
                {review.items.length.toLocaleString('en-US')} places on the map
                {editable && <> · {counts.accept} to save · {counts.pending} need a decision · {counts.reject} skipped</>}
                {review.saved && <> · <strong className="text-go">✓ saved to BSA</strong></>}
                {review.readOnly && <> · read-only</>}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {editable && <button type="button" className="btn-secondary" onClick={() => { setMode('add'); setTab('capture'); }} disabled={!!busy}>+ Add a missing place</button>}
              <button type="button" className="btn-secondary" onClick={clearReview} disabled={!!busy}>{editable ? 'Discard' : 'Clear map'}</button>
              {editable && (!confirmSave
                ? <button type="button" className="btn-primary" disabled={counts.pending > 0 || counts.accept === 0 || !!busy} onClick={() => setConfirmSave(true)}>Save {counts.accept} to BSA</button>
                : <span className="flex items-center gap-2"><span className="text-label">Every broker&apos;s analysis will use these places. Save?</span><button type="button" className="btn-primary" onClick={save} disabled={!!busy}>{busy ?? 'Yes, save'}</button><button type="button" className="btn-secondary" onClick={() => setConfirmSave(false)}>Cancel</button></span>)}
            </div>
          </div>

          {(projected || after) && readiness && (
            <TerritoryDelta before={before ?? readiness.summary} next={after ?? projected!} saved={!!after} conceptLabel={readiness.concept?.label ?? null} catchmentM={readiness.catchmentM} />
          )}
          {counts.pending > 0 && editable && <p className="mt-3 text-label font-normal text-caution">▲ {counts.pending} place(s) need a decision before you can save — possible duplicates of places already in BSA, or pins without a category. They are listed first.</p>}
          {review.notes.length > 0 && <ul className="mt-2 space-y-1 text-label font-normal text-ink-muted">{review.notes.map((n) => <li key={n}>{n}</li>)}</ul>}

          <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Show">
            {([
              ['all', `All (${tiered.length})`],
              ['pending', `Needs decision (${counts.pending})`],
              ['direct', `◆ Direct (${counts.direct})`],
              ['adjacent', `■ Adjacent (${counts.adjacent})`],
              ['unrelated', `● Other businesses (${counts.unrelated})`],
              ['context', `○ Context (${counts.context})`],
              ['existing', `Already in BSA (${counts.existing})`],
            ] as Array<[typeof group, string]>).map(([g, l]) => (
              <button key={g} type="button" aria-pressed={group === g} onClick={() => { setGroup(g); setShown(PAGE); }}
                className={`rounded-full border px-3 py-1 text-label ${group === g ? 'border-accent-soft bg-ink-hover text-ink-text' : 'border-ink-border text-ink-muted'}`}>{l}</button>
            ))}
            <input aria-label="Search names" className="field ml-auto min-h-[36px] w-48" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {editable && visible.length > 0 && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="link text-label" onClick={() => updateItems(visible.filter((i) => !(i.origin === 'file' && i.existingPoiId)).map((i) => i.key), { decision: 'accept' })}>Save all shown</button>
              <span className="text-ink-muted">·</span>
              <button type="button" className="link text-label" onClick={() => updateItems(visible.map((i) => i.key), { decision: 'reject' })}>Skip all shown</button>
            </div>
          )}

          <div className="mt-3 max-h-[520px] overflow-auto">
            <table className="w-full text-label">
              <caption className="sr-only">Places on the map</caption>
              <thead className="sticky top-0 z-10 bg-ink-panel text-ink-muted">
                <tr><th className="py-2 text-left font-normal">Place</th><th className="text-left font-normal">Territory Guard</th><th className="text-left font-normal">Category</th><th className="text-left font-normal">Truth</th><th className="text-left font-normal">Status</th>{editable && <th className="text-left font-normal">Decision</th>}</tr>
              </thead>
              <tbody>
                {visible.slice(0, shown).map((it) => {
                  const d = reviewSite ? Math.round(distanceM(reviewSite.lat, reviewSite.lon, it.lat, it.lon)) : null;
                  const inCatch = d != null && readiness && d <= readiness.catchmentM;
                  const renamed = it.name !== it.originalName;
                  const lockedExisting = it.origin === 'file' && !!it.existingPoiId;
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
                      <td className="pr-2 text-ink-muted">
                        {review.readOnly || review.saved ? '✓ in BSA'
                          : lockedExisting ? 'Already in BSA (kept as is)'
                            : it.existingPoiId ? 'In BSA — save refreshes it'
                              : it.duplicateOf ? `▲ looks like “${it.duplicateOf.name}”`
                                : 'new'}
                      </td>
                      {editable && (
                        <td>
                          <div role="radiogroup" aria-label={`Decision for ${it.name}`} className="flex gap-1">
                            {(['accept', 'reject'] as const).map((dc) => (
                              <button key={dc} type="button" role="radio" aria-checked={it.decision === dc} disabled={dc === 'accept' && lockedExisting}
                                onClick={() => updateItems([it.key], { decision: dc })}
                                className={`rounded-control border px-2 py-1 disabled:opacity-40 ${it.decision === dc ? (dc === 'accept' ? 'border-go text-go' : 'border-nogo text-nogo') : 'border-ink-border text-ink-muted'}`}>
                                {dc === 'accept' ? '✓ Save' : '✕ Skip'}
                              </button>
                            ))}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length > shown && <button type="button" className="btn-secondary mt-3" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}</button>}
            {visible.length === 0 && <p className="py-4 text-label text-ink-muted">Nothing in this group.</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function cssId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
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

/** "What Territory Guard sees here now" — counted inside the catchment exactly as the module does. */
function TerritoryReadout({ readiness, loading, vertical }: { readiness: Readiness | null; loading: boolean; vertical: string }) {
  if (!readiness) return <p className="mt-3 text-label text-ink-muted">{loading ? 'Checking what BSA already holds here…' : ''}</p>;
  const s = readiness.summary;
  return (
    <div className="card-inset mt-4 p-3" aria-live="polite">
      <p className="overline">Territory Guard sees here now{loading ? ' · updating…' : ''}</p>
      {!vertical
        ? <p className="mt-1 text-label font-normal text-ink-muted">Pick a business type to see the competitor count. {s.ring.context + s.ring.unrelated + s.ring.direct + s.ring.adjacent} places already in BSA inside the ring.</p>
        : (
          <>
            <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
              <div><dt className="text-label font-normal text-ink-muted">◆ Direct</dt><dd className="text-h3 text-ink-text">{s.catchment.direct}</dd></div>
              <div><dt className="text-label font-normal text-ink-muted">■ Adjacent</dt><dd className="text-h3 text-ink-text">{s.catchment.adjacent}</dd></div>
              <div><dt className="text-label font-normal text-ink-muted">Saturation</dt><dd className="text-h3 text-ink-text">{Math.round(s.saturationPct)}%</dd></div>
            </dl>
            <p className="mt-2 text-label font-normal text-ink-muted">
              Inside the {readiness.catchmentM.toLocaleString('en-US')} m catchment, for {readiness.concept?.label ?? 'this business'}. Saturation is Projected (same curve as Territory Guard).
              {s.catchment.direct === 0 && ' No direct competitors in BSA here yet — capture to fill this in.'}
            </p>
            {readiness.coverage && (
              <p className="mt-1 text-label font-normal text-ink-muted">Coverage for this business type: {readiness.coverage.fresh} of {readiness.coverage.cells} map cells already captured.</p>
            )}
          </>
        )}
    </div>
  );
}

function TerritoryDelta({ before, next, saved, conceptLabel, catchmentM }: { before: TerritorySummary; next: TerritorySummary; saved: boolean; conceptLabel: string | null; catchmentM: number }) {
  const row = (label: string, a0: number, b0: number, suffix = '') => {
    const a = Math.round(a0), b = Math.round(b0);
    return (
    <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-muted">{label}</dt><dd className="text-ink-text">{a}{suffix} → <strong>{b}{suffix}</strong>{b !== a && <span className="ml-1 text-ink-muted">({b > a ? '+' : ''}{b - a})</span>}</dd></div>
    );
  };
  return (
    <div className="card-inset mt-4 grid gap-2 p-4 text-label font-normal sm:grid-cols-[1fr_1fr]">
      <p className="sm:col-span-2"><strong>{saved ? 'Territory Guard now sees' : 'After saving, Territory Guard will see'}</strong> <span className="text-ink-muted">— {conceptLabel ?? 'this business'}, {catchmentM.toLocaleString('en-US')} m catchment</span></p>
      <dl className="space-y-1">{row('◆ Direct competitors', before.catchment.direct, next.catchment.direct)}{row('■ Adjacent formats', before.catchment.adjacent, next.catchment.adjacent)}</dl>
      <dl className="space-y-1">{row('Competitive saturation (Projected)', before.saturationPct, next.saturationPct, '%')}{row('Context places in ring', before.ring.context, next.ring.context)}</dl>
    </div>
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
