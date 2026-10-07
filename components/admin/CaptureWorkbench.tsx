'use client';

/**
 * Admin Place Capture — grid-navigator's capture loop, aligned to Territory Guard (2026-10-07).
 *
 *   1 · Drop the site pin      → coordinate + PSGC barangay/city/province it falls in
 *   2 · Business & catchment   → same catchment rings, tiers and saturation Territory Guard uses,
 *                                with a live "what Territory Guard sees here now" read-out
 *   3 · Capture                → pull the ring from OpenStreetMap (server-side) into a draft batch
 *   4 · Review & save          → grouped exactly as Territory Guard will count them; save writes
 *                                to `poi`, PSGC-tags each place and marks the cells as covered
 *
 * The browser never calls OpenStreetMap or the database: everything goes through the admin-only
 * /api/admin/capture/* routes. Nothing reaches the shared places table until an admin saves.
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
  id: string; label: string; source: string; status: 'draft' | 'committed' | 'discarded';
  itemCount: number; committedCount: number; createdAt: string; createdBy: string | null;
}
interface Item {
  id: string; osmRef: string | null; name: string; kind: string | null; category: BsaPoiCategory;
  lat: number; lon: number; source: string; truthLayer: 'verified' | 'assumed' | 'projected';
  decision: Decision; existingPoiId: string | null; duplicateOfPoiId: string | null;
  committedPoiId: string | null; notes: string | null;
}
interface SiteContext { site?: { lat: number; lon: number }; vertical?: string; brand?: string; format?: SiteFormat }
interface BatchDetail {
  batch: BatchSummary & { notes: string | null; areaSpec: (CaptureArea & { context?: SiteContext | null }) | null; layers: string[] };
  counts: { accept: number; reject: number; pending: number; existing: number; duplicates: number };
  items: Item[];
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
  try {
    const res = await fetch(url, init);
    return (await res.json()) as ApiResult<T>;
  } catch {
    return { ok: false, error: { code: 'network', message: 'Network error — check your connection and try again.' } };
  }
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
  // Capture / review
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [before, setBefore] = useState<TerritorySummary | null>(null);
  const [after, setAfter] = useState<TerritorySummary | null>(null);
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [group, setGroup] = useState<'all' | PlaceTier | 'pending' | 'existing'>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const [showCoverage, setShowCoverage] = useState(true);
  const [regionTotals, setRegionTotals] = useState<Array<{ region: string | null; total: number; tagged: number }>>([]);

  useEffect(() => { modeRef.current = mode; if (mode !== 'rect') rectStart.current = null; }, [mode]);

  const catchmentM = catchmentFor(format);
  const concept = useMemo(() => conceptForSite(detail?.batch.areaSpec?.context?.vertical ?? vertical, detail?.batch.areaSpec?.context?.brand ?? brand), [detail, vertical, brand]);
  const area: CaptureArea | null = rect ?? (site ? { kind: 'circle', lat: site.lat, lon: site.lon, radiusM } : null);
  const km2 = area ? areaKm2(area) : 0;
  const tooBig = km2 > MAX_CAPTURE_KM2;
  const layers = layersForSite(vertical, extras);

  /* ---------------------------------------------------------------- data */

  const loadBatches = useCallback(async () => {
    const r = await api<BatchSummary[]>('/api/admin/capture/batches');
    if (r.ok) setBatches(r.data);
  }, []);

  const loadBatch = useCallback(async (id: string) => {
    const r = await api<BatchDetail>(`/api/admin/capture/batches/${id}`);
    if (r.ok) { setDetail(r.data); setShown(PAGE); setConfirmCommit(false); setGroup('all'); }
    else setMsg({ tone: 'err', text: r.error.message });
    return r.ok ? r.data : null;
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

  // Refresh "what Territory Guard sees" whenever the site or its business settings change.
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
      // Frame the whole capture ring, like Territory Guard frames the site and its catchment.
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
        // Capture ring (dashed) + catchment ring (filled) — the same two rings Territory Guard draws.
        map.addLayer({ id: 'scan-line', type: 'line', source: 'scan', paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [3, 2] } });
        map.addLayer({ id: 'rect-fill', type: 'fill', source: 'rect', paint: { 'fill-color': accent, 'fill-opacity': 0.08 } });
        map.addLayer({ id: 'rect-line', type: 'line', source: 'rect', paint: { 'line-color': accent, 'line-width': 2 } });
        map.addLayer({ id: 'catchment-fill', type: 'fill', source: 'catchment', paint: { 'fill-color': accent, 'fill-opacity': 0.12 } });
        map.addLayer({ id: 'catchment-line', type: 'line', source: 'catchment', paint: { 'line-color': accent, 'line-width': 2 } });
        map.addLayer({
          id: 'existing-icons', type: 'symbol', source: 'existing',
          layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-size': 0.8, 'symbol-sort-key': ['get', 'rank'] },
          paint: { 'icon-opacity': 0.6 },
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
        const id = e.features?.[0]?.properties?.id;
        if (id && modeRef.current === 'none') setSelected(String(id));
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

  // Rings.
  useEffect(() => {
    if (!mapReady) return;
    const map = mapRef.current!;
    const set = (id: string, data: GeoJSON.Feature | typeof EMPTY_FC) => (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
    set('catchment', site ? geoCircle(site.lon, site.lat, catchmentM) as GeoJSON.Feature : EMPTY_FC);
    set('scan', site && !rect ? geoCircle(site.lon, site.lat, radiusM) as GeoJSON.Feature : EMPTY_FC);
    set('rect', rect ? { type: 'Feature', properties: {}, geometry: areaGeoJson(rect) } : EMPTY_FC);
  }, [site, catchmentM, radiusM, rect, mapReady]);

  // Places already in BSA around the site, styled the way Territory Guard will tier them.
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

  // Staged items.
  const tiered = useMemo(() => (detail?.items ?? []).map((it) => ({ ...it, tier: tierOfPlace(it, concept) })), [detail, concept]);
  const reviewSite = detail?.batch.areaSpec?.context?.site ?? site;
  useEffect(() => {
    if (!mapReady) return;
    const src = mapRef.current?.getSource('items') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: tiered.map((it) => ({
        type: 'Feature',
        properties: { id: it.id, decision: it.decision, icon: `ic-${it.tier}`, rank: TIER_META[it.tier].rank + 10, selected: it.id === selected ? 1 : 0 },
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
    if (selected) document.getElementById(`cap-row-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  /* ---------------------------------------------------------------- actions */

  function goToCoords() {
    const p = parseLatLon(coordText);
    if (!p) { setCoordErr('Use “latitude, longitude” inside the Philippines, e.g. 14.2846, 121.0966'); return; }
    setCoordErr(null);
    placeSite(p.lat, p.lon, true);
    setMode('none');
  }

  async function capture() {
    if (!area || tooBig || !layers.length || !site && !rect) return;
    setBusy('Pulling places from OpenStreetMap…'); setMsg(null); setAfter(null);
    setBefore(readiness?.summary ?? null);
    const label = [CAPTURE_VERTICALS.find((v) => v.key === vertical)?.label, brand.trim(), readiness?.boundary?.city ?? readiness?.boundary?.barangay].filter(Boolean).join(' · ') || undefined;
    const r = await api<{ batchId: string; staged: number; notes: string[] }>('/api/admin/capture/preview', jsonInit('POST', {
      area, layers, label,
      context: { site: site ?? undefined, vertical: vertical || undefined, brand: brand.trim() || undefined, format },
    }));
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    setMsg({ tone: 'ok', text: `${r.data.staged} places found. Review them below — nothing is saved until you press Save.` });
    await loadBatch(r.data.batchId); await loadBatches();
    setTimeout(() => document.getElementById('cap-review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  async function importFile(file: File) {
    if (file.size > 10 * 1024 * 1024) { setMsg({ tone: 'err', text: 'File is larger than 10 MB. In Grid Navigator, save the session without cached map tiles.' }); return; }
    setBusy('Reading the Grid Navigator session…'); setMsg(null);
    const text = await file.text();
    const r = await api<{ batchId: string; staged: number }>('/api/admin/capture/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-file-name': file.name.replace(/[^\x20-\x7e]/g, '_').slice(0, 80) }, body: text,
    });
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    setMsg({ tone: 'ok', text: `${r.data.staged} places staged from the session file. Review them below.` });
    const d = await loadBatch(r.data.batchId); await loadBatches();
    const first = d?.items[0];
    if (first) mapRef.current?.flyTo({ center: [first.lon, first.lat], zoom: 13 });
  }

  async function savePin(form: { name: string; category: BsaPoiCategory; notes: string }) {
    if (!pin) return;
    const draftId = detail?.batch.status === 'draft' ? detail.batch.id : undefined;
    setBusy('Adding place…');
    const r = await api<{ batchId: string }>('/api/admin/capture/manual', jsonInit('POST', { ...pin, ...form, notes: form.notes || undefined, batchId: draftId }));
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    setPin(null); setMode('none');
    setMsg({ tone: 'ok', text: `“${form.name}” added to the review list as Assumed. Save the batch to keep it.` });
    await loadBatch(r.data.batchId); await loadBatches();
  }

  async function patchItems(updates: Array<{ id: string; decision?: Decision; name?: string; category?: BsaPoiCategory }>) {
    if (!detail) return;
    for (let i = 0; i < updates.length; i += 1000) {
      const r = await api<{ changed: number }>(`/api/admin/capture/batches/${detail.batch.id}`, jsonInit('PATCH', { updates: updates.slice(i, i + 1000) }));
      if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); break; }
    }
    await loadBatch(detail.batch.id);
  }

  async function commit() {
    if (!detail) return;
    setBefore((b) => b ?? readiness?.summary ?? null);
    setBusy('Saving to BSA…'); setMsg(null);
    const r = await api<{ committed: number; psgcTagged: number; skippedExisting: number; coverageStamped: number }>(`/api/admin/capture/batches/${detail.batch.id}/commit`, { method: 'POST' });
    setBusy(null); setConfirmCommit(false);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    const untagged = r.data.committed - r.data.psgcTagged;
    setMsg({ tone: 'ok', text: `Saved ${r.data.committed} places to BSA.${untagged > 0 ? ` ${untagged} have no barangay yet (boundaries not loaded there).` : ' Every place is tagged with its barangay.'}${r.data.skippedExisting ? ` ${r.data.skippedExisting} were already in BSA and left unchanged.` : ''}` });
    await loadBatch(detail.batch.id); await loadBatches(); await loadCoverage();
    if (reviewSite) {
      const fresh = await fetchReadiness(reviewSite);
      if (fresh) setAfter(fresh.summary);
    }
  }

  async function discard() {
    if (!detail) return;
    const r = await api(`/api/admin/capture/batches/${detail.batch.id}`, { method: 'DELETE' });
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    setDetail(null); setMsg({ tone: 'ok', text: 'Batch discarded. Nothing was saved.' }); await loadBatches();
  }

  async function openBatch(id: string) {
    setBefore(null); setAfter(null);
    const d = await loadBatch(id);
    const ctx = d?.batch.areaSpec?.context;
    if (ctx?.site) {
      placeSite(ctx.site.lat, ctx.site.lon, true);
      if (ctx.vertical) setVertical(ctx.vertical);
      if (ctx.brand) setBrand(ctx.brand);
      if (ctx.format) setFormat(ctx.format);
      if (d?.batch.areaSpec?.kind === 'circle') setRadiusM(d.batch.areaSpec.radiusM);
      setMode('none');
    } else if (d?.items[0]) {
      mapRef.current?.flyTo({ center: [d.items[0].lon, d.items[0].lat], zoom: 13 });
    }
  }

  function flyTo(lat: number, lon: number, zoom = 13) { mapRef.current?.flyTo({ center: [lon, lat], zoom }); }

  /* ---------------------------------------------------------------- review list */

  const groupCounts = useMemo(() => {
    const c = { direct: 0, adjacent: 0, unrelated: 0, context: 0, pending: 0, existing: 0 };
    for (const it of tiered) { c[it.tier]++; if (it.decision === 'pending') c.pending++; if (it.existingPoiId) c.existing++; }
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
  const editable = detail?.batch.status === 'draft';

  // What Territory Guard WILL see once this batch is saved (existing + accepted staged places).
  const projected = useMemo(() => {
    if (!reviewSite || !readiness || !detail || !editable) return null;
    const known = new Set(tiered.filter((i) => i.existingPoiId).map((i) => i.existingPoiId));
    const existing = readiness.places.filter((p) => !known.has(p.id)).map((p) => ({ tier: p.tier, distM: p.distM }));
    const staged = tiered.filter((i) => i.decision === 'accept').map((i) => ({ tier: i.tier, distM: distanceM(reviewSite.lat, reviewSite.lon, i.lat, i.lon) }));
    return summariseForTerritory([...existing, ...staged], readiness.catchmentM);
  }, [reviewSite, readiness, detail, editable, tiered]);

  const step1Done = !!site || !!rect;
  const step2Done = step1Done && !!vertical;

  /* ---------------------------------------------------------------- render */

  return (
    <div className="flex flex-col gap-5">
      <div role="tablist" aria-label="Place Capture" className="flex flex-wrap gap-2">
        {([['capture', 'Capture around a site'], ['import', 'Import a field session'], ['history', 'History & coverage']] as Array<[Tab, string]>).map(([t, l]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`btn min-h-[40px] px-4 text-label ${tab === t ? 'bg-ink-hover font-semibold text-ink-text shadow-[inset_0_-2px_0_#BE8562]' : 'border border-ink-border text-ink-muted'}`}>{l}</button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
        {/* ------------------------------------------------ control panel */}
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
                        : readiness && <p className="text-caution">▲ No barangay boundary loaded here{readiness.region ? ` (approx. region: ${REGIONS.find((r) => r.key === readiness.region)?.name ?? readiness.region})` : ''}. Places will still save with exact coordinates; load the region&apos;s boundaries to tag barangays.</p>}
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

              <Step n={3} title="Capture from OpenStreetMap" done={!!detail && detail.batch.source === 'osm'} disabled={!step2Done}>
                <p className="field-help">Pulls the {CAPTURE_VERTICALS.find((v) => v.key === vertical)?.label ?? 'business'} competitor set inside the ring, plus the context places below.</p>
                <fieldset className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2" disabled={!step2Done}>
                  <legend className="sr-only">Also capture</legend>
                  {BASE_LAYERS.filter((l) => CONTEXT_LAYERS.includes(l.key as BaseLayerKey)).map((l) => (
                    <label key={l.key} className="flex items-start gap-2 text-label" title={l.hint}>
                      <input type="checkbox" className="mt-1" checked={extras.includes(l.key as BaseLayerKey)}
                        onChange={(e) => setExtras((xs) => e.target.checked ? [...xs, l.key as BaseLayerKey] : xs.filter((x) => x !== l.key))} />
                      <span>{l.label}</span>
                    </label>
                  ))}
                </fieldset>
                {area && <p className={`mt-3 text-label font-normal ${tooBig ? 'text-nogo' : 'text-ink-muted'}`}>{tooBig ? '✕ ' : ''}Area ≈ {km2.toFixed(1)} km²{tooBig ? ` — over the ${MAX_CAPTURE_KM2} km² limit. Make the ring smaller.` : ''}</p>}
                <button type="button" className="btn-primary mt-3 w-full" disabled={!step2Done || !area || tooBig || !layers.length || !!busy} onClick={capture}>
                  {busy ?? 'Find places in this ring'}
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
                <li>Pick the <code>.gridnav.json</code> file below (10 MB max).</li>
                <li>Its places arrive as <strong>Assumed</strong>; checkpoints arrive as pins that need a category.</li>
              </ol>
              <input type="file" accept=".json,application/json" className="mt-4 block w-full text-label text-ink-muted" disabled={!!busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
              {busy && <p className="mt-2 text-label text-ink-muted">{busy}</p>}
            </section>
          )}

          {tab === 'history' && (
            <section className="card p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-body text-title">Capture history</h2>
                <label className="flex items-center gap-2 text-label text-ink-muted">
                  <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} /> Show saved areas
                </label>
              </div>
              <ul className="mt-3 max-h-[360px] space-y-1 overflow-y-auto">
                {batches.length === 0 && <li className="text-label text-ink-muted">No captures yet.</li>}
                {batches.map((b) => (
                  <li key={b.id}>
                    <button type="button" onClick={() => openBatch(b.id)} className={`nav-item w-full text-left ${detail?.batch.id === b.id ? 'nav-item-active' : ''}`}>
                      <span className="min-w-0 flex-1 truncate">{b.label}</span>
                      <span className="shrink-0 text-label font-normal text-ink-muted">{b.status === 'committed' ? `✓ ${b.committedCount} saved` : b.status === 'draft' ? `draft · ${b.itemCount}` : 'discarded'}</span>
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
          {pin && <PinForm pin={pin} busy={!!busy} onCancel={() => { setPin(null); setMode('none'); }} onSave={savePin} />}
        </div>

        {/* ------------------------------------------------ map */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="relative h-[62vh] min-h-[440px] overflow-hidden rounded-card border border-ink-border xl:sticky xl:top-4">
            <div ref={mapEl} className="absolute inset-0 h-full w-full" aria-label="Capture map" role="application" />
            {mode !== 'none' && (
              <p className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-ink-panel/95 px-4 py-1.5 text-label text-ink-text shadow-e1">
                {mode === 'site' ? 'Click the map to place the site pin' : mode === 'add' ? 'Click where the missing place is' : rectStart.current ? 'Click the opposite corner' : 'Click the first corner'}
              </p>
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

      {/* ------------------------------------------------ review */}
      {detail && (
        <section id="cap-review" className="card scroll-mt-4 p-5" aria-labelledby="cap-review-h">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="overline">Step 4</p>
              <h2 id="cap-review-h" className="font-body text-title">Review &amp; save — {detail.batch.label}</h2>
              <p className="mt-1 text-label font-normal text-ink-muted">
                {detail.items.length.toLocaleString('en-US')} places · {detail.counts.accept} to save · {detail.counts.pending} need a decision · {detail.counts.reject} skipped · status <strong className="text-ink-text">{detail.batch.status}</strong>
              </p>
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn-secondary" onClick={() => { setMode('add'); setTab('capture'); }} disabled={!!busy}>+ Add a missing place</button>
                <button type="button" className="btn-secondary" onClick={discard} disabled={!!busy}>Discard</button>
                {!confirmCommit
                  ? <button type="button" className="btn-primary" disabled={detail.counts.pending > 0 || detail.counts.accept === 0 || !!busy} onClick={() => setConfirmCommit(true)}>Save {detail.counts.accept} to BSA</button>
                  : <span className="flex items-center gap-2"><span className="text-label">Every broker&apos;s analysis will use these places. Save?</span><button type="button" className="btn-primary" onClick={commit} disabled={!!busy}>{busy ?? 'Yes, save'}</button><button type="button" className="btn-secondary" onClick={() => setConfirmCommit(false)}>Cancel</button></span>}
              </div>
            )}
          </div>

          {(projected || after) && readiness && (
            <TerritoryDelta before={before ?? readiness.summary} next={after ?? projected!} saved={!!after} conceptLabel={readiness.concept?.label ?? null} catchmentM={readiness.catchmentM} />
          )}
          {detail.counts.pending > 0 && editable && <p className="mt-3 text-label font-normal text-caution">▲ {detail.counts.pending} place(s) need a decision before you can save — possible duplicates of places already in BSA, or pins without a category. They are listed first.</p>}
          {detail.batch.notes && <p className="mt-2 whitespace-pre-line text-label font-normal text-ink-muted">{detail.batch.notes}</p>}

          <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Show">
            {([
              ['all', `All (${tiered.length})`],
              ['pending', `Needs decision (${groupCounts.pending})`],
              ['direct', `◆ Direct (${groupCounts.direct})`],
              ['adjacent', `■ Adjacent (${groupCounts.adjacent})`],
              ['unrelated', `● Other businesses (${groupCounts.unrelated})`],
              ['context', `○ Context (${groupCounts.context})`],
              ['existing', `Already in BSA (${groupCounts.existing})`],
            ] as Array<[typeof group, string]>).map(([g, l]) => (
              <button key={g} type="button" aria-pressed={group === g} onClick={() => { setGroup(g); setShown(PAGE); }}
                className={`rounded-full border px-3 py-1 text-label ${group === g ? 'border-accent-soft bg-ink-hover text-ink-text' : 'border-ink-border text-ink-muted'}`}>{l}</button>
            ))}
            <input aria-label="Search names" className="field ml-auto min-h-[36px] w-48" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {editable && visible.length > 0 && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="link text-label" onClick={() => patchItems(visible.map((i) => ({ id: i.id, decision: 'accept' })))}>Save all shown</button>
              <span className="text-ink-muted">·</span>
              <button type="button" className="link text-label" onClick={() => patchItems(visible.map((i) => ({ id: i.id, decision: 'reject' })))}>Skip all shown</button>
            </div>
          )}

          <div className="mt-3 max-h-[520px] overflow-auto">
            <table className="w-full text-label">
              <caption className="sr-only">Places found</caption>
              <thead className="sticky top-0 z-10 bg-ink-panel text-ink-muted">
                <tr><th className="py-2 text-left font-normal">Place</th><th className="text-left font-normal">Territory Guard</th><th className="text-left font-normal">Category</th><th className="text-left font-normal">Truth</th><th className="text-left font-normal">Status</th>{editable && <th className="text-left font-normal">Decision</th>}</tr>
              </thead>
              <tbody>
                {visible.slice(0, shown).map((it) => {
                  const d = reviewSite ? Math.round(distanceM(reviewSite.lat, reviewSite.lon, it.lat, it.lon)) : null;
                  const inCatch = d != null && readiness && d <= readiness.catchmentM;
                  return (
                    <tr key={it.id} id={`cap-row-${it.id}`} className={`border-t border-ink-border align-top ${selected === it.id ? 'bg-ink-hover' : ''}`}>
                      <td className="py-2 pr-2">
                        <button type="button" className="text-left text-ink-text hover:underline" onClick={() => { setSelected(it.id); flyTo(it.lat, it.lon, 17); }}>{it.name}</button>
                        <div className="font-normal text-ink-muted">{it.kind ?? 'added by hand'}{d != null ? ` · ${d.toLocaleString('en-US')} m from site${inCatch ? ' (in catchment)' : ''}` : ''}{it.notes ? ` · ${it.notes}` : ''}</div>
                      </td>
                      <td className="pr-2"><span className={it.tier === 'direct' ? 'text-nogo' : it.tier === 'adjacent' ? 'text-caution' : 'text-ink-muted'}>{TIER_META[it.tier].glyph} {TIER_META[it.tier].short}</span></td>
                      <td className="pr-2">
                        {editable && !it.committedPoiId
                          ? <select aria-label={`Category for ${it.name}`} className="rounded-control border border-ink-border-strong bg-ink-panel-2 px-2 py-1" value={it.category} onChange={(e) => patchItems([{ id: it.id, category: e.target.value as BsaPoiCategory }])}>
                              {BSA_POI_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                            </select>
                          : CATEGORY_LABEL[it.category]}
                      </td>
                      <td className="pr-2"><TruthChip layer={it.truthLayer} compact /></td>
                      <td className="pr-2 text-ink-muted">{it.committedPoiId ? '✓ saved' : it.existingPoiId ? 'In BSA — will refresh' : it.duplicateOfPoiId ? '▲ possible duplicate' : 'new'}</td>
                      {editable && (
                        <td>
                          <div role="radiogroup" aria-label={`Decision for ${it.name}`} className="flex gap-1">
                            {(['accept', 'reject'] as const).map((dc) => (
                              <button key={dc} type="button" role="radio" aria-checked={it.decision === dc} disabled={!!it.committedPoiId}
                                onClick={() => patchItems([{ id: it.id, decision: dc }])}
                                className={`rounded-control border px-2 py-1 ${it.decision === dc ? (dc === 'accept' ? 'border-go text-go' : 'border-nogo text-nogo') : 'border-ink-border text-ink-muted'}`}>
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
        <button type="button" className="btn-primary" disabled={!name.trim() || busy} onClick={() => onSave({ name: name.trim(), category, notes: notes.trim() })}>Add to review</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
