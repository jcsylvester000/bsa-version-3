'use client';

/**
 * Admin → Capture Coverage (2026-10-08). The log of every saved capture area, a map of what is
 * covered and how fresh it is, and the retry queue of areas/layers OpenStreetMap did not return.
 *
 *   • Map: saved areas (green = captured in the last 90 days, grey = re-capture due), open retry
 *     entries (red dashed), and — for one layer — Territory Guard's ~1.1 km coverage cells.
 *   • Retry queue: each missed area + layer, with "Retry now" (opens Place Capture on exactly that
 *     area and layer) or "Dismiss". Entries close automatically when a save covers them.
 *   • Capture log: where, when, who, what loaded completely, what was missed, how many places were new.
 *
 * Read-only apart from Dismiss / Re-open. Everything goes through the admin-only /api/admin/capture/* routes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { defaultBasemapUrl, basemapPaint, OSM_ATTRIBUTION, OSM_MAX_ZOOM } from '@/lib/ui/theme';
import { ALL_LAYERS } from '@/lib/capture/layers';
import { listRegions } from '@/lib/geo/regions';
import { PH_REGIONS } from '@/lib/geo/phRegions';
import { manilaShortStampYear } from '@/lib/util/manilaTime';
import { FRESH_DAYS, osmWindow, type OsmWindow } from '@/lib/capture/capturePolicy';
import { DemandPanel, type DemandItem } from '@/components/admin/DemandPanel';

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    try { return (await res.json()) as ApiResult<T>; } catch { return { ok: false, error: { code: `http_${res.status}`, message: `The server answered ${res.status}.` } }; }
  } catch {
    return { ok: false, error: { code: 'network', message: 'Network error — check your connection and try again.' } };
  }
}

interface LogArea {
  id: string; label: string; source: string; layers: string[]; fetchedLayers: string[]; itemCount: number; savedCount: number;
  createdAt: string; createdBy: string | null; lat: number; lon: number; km2: number;
  barangay: string | null; city: string | null; province: string | null; region: string | null; geometry: GeoJSON.Geometry | null;
}
interface Gap {
  id: string; layer: string; label: string; reason: 'timeout' | 'limit' | 'error'; message: string | null; attempts: number;
  status: 'open' | 'resolved' | 'dismissed'; createdAt: string; lastAttemptAt: string; resolvedAt: string | null; createdBy: string | null;
  lat: number; lon: number; barangay: string | null; city: string | null; province: string | null; region: string | null; geometry: GeoJSON.Geometry | null;
}
interface LogData {
  totals: { batches: number; places: number; areas_km2: number; last_at: string | null; openGaps: number };
  areas: LogArea[]; gaps: Gap[];
  regions: Array<{ region: string | null; total: number; tagged: number }>;
  boundaries?: Array<{ region: string | null; barangays: number }>;
  coverageKeys: Array<{ vertical: string; cells: number }>;
}
interface OsmStatus { reachable: boolean; slotsNow: number | null; waitSeconds: number; window: OsmWindow }
interface Cell { key: string; lat: number; lon: number; poiCount: number; fetchedAt: string; source: string }

const DAY = 86_400_000;
const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] };
const LAYER_LABEL: Record<string, string> = Object.fromEntries(ALL_LAYERS.map((l) => [l.key, l.label]));
const REGION_LABEL: Record<string, string> = Object.fromEntries(listRegions().map((r) => [r.key, r.name]));
const layerName = (k: string) => LAYER_LABEL[k] ?? k;
/** poi_coverage key → readable name ("fnb_qsr" → QSR…, "layer:anchors" → Everyday anchors). */
const coverageName = (k: string) => (k.startsWith('layer:') ? LAYER_LABEL[k.slice(6)] ?? k : LAYER_LABEL[`v:${k}`] ?? k);
/** Registered BSA region key, or `ph-<code>` for boundaries loaded on demand elsewhere (e.g. ph-car). */
const regionName = (r: string | null) => {
  if (!r) return 'Unknown region';
  if (REGION_LABEL[r]) return REGION_LABEL[r];
  const ph = r.startsWith('ph-') ? PH_REGIONS.find((x) => x.code.toLowerCase() === r.slice(3)) : undefined;
  return ph?.name ?? r;
};
const place = (x: { barangay: string | null; city: string | null; province: string | null }) =>
  [x.barangay ? `Brgy ${x.barangay}` : null, x.city, x.province].filter(Boolean).join(', ') || 'No boundary loaded here';
const ageDays = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
const stamp = (iso: string) => manilaShortStampYear(new Date(iso));
const REASON: Record<Gap['reason'], string> = { timeout: 'OpenStreetMap timed out', limit: 'Too many places — incomplete', error: 'OpenStreetMap error' };

function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v ? `rgb(${v.split(/\s+/).join(',')})` : fallback;
}

function bboxOfGeometry(g: GeoJSON.Geometry | null, lat: number, lon: number): [[number, number], [number, number]] {
  let s = lat, w = lon, n = lat, e = lon;
  const walk = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') { const [x, y] = c as number[]; s = Math.min(s, y); n = Math.max(n, y); w = Math.min(w, x); e = Math.max(e, x); }
    else if (Array.isArray(c)) c.forEach(walk);
  };
  if (g && 'coordinates' in g) walk(g.coordinates);
  return [[w, s], [e, n]];
}

export function CoverageMonitor() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [data, setData] = useState<LogData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'all' | 'fresh' | 'stale'>('all');
  const [region, setRegion] = useState('all');
  const [search, setSearch] = useState('');
  const [gapView, setGapView] = useState<'open' | 'closed'>('open');
  const [cellLayer, setCellLayer] = useState('');
  const [cellNote, setCellNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [shown, setShown] = useState(100);
  const [pickMode, setPickMode] = useState(false);
  const pickRef = useRef(false);
  const [busyGap, setBusyGap] = useState<string | null>(null);
  const [osm, setOsm] = useState<OsmStatus | null>(null);
  useEffect(() => {
    const go = async () => { const r = await api<OsmStatus>('/api/admin/capture/osm-status'); if (r.ok) setOsm(r.data); };
    void go();
    const t = setInterval(() => { void go(); }, 60_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await api<LogData>('/api/admin/capture/log');
    setLoading(false);
    if (!r.ok) { setErr(r.error.message); return; }
    setErr(null);
    setData(r.data);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { pickRef.current = pickMode; if (mapRef.current) mapRef.current.getCanvas().style.cursor = pickMode ? 'crosshair' : ''; }, [pickMode]);

  /* ---------------------------------------------------------------- derived */

  const regionsPresent = useMemo(() => {
    const set = new Set<string>();
    for (const a of data?.areas ?? []) if (a.region) set.add(a.region);
    for (const g of data?.gaps ?? []) if (g.region) set.add(g.region);
    return [...set].sort((a, b) => regionName(a).localeCompare(regionName(b)));
  }, [data]);

  const match = useCallback((x: { label: string; region: string | null; barangay: string | null; city: string | null; province: string | null }) => {
    if (region !== 'all' && x.region !== region) return false;
    const q = search.trim().toLowerCase();
    return !q || [x.label, x.barangay, x.city, x.province].some((v) => v?.toLowerCase().includes(q));
  }, [region, search]);

  const areas = useMemo(() => (data?.areas ?? []).filter((a) => {
    const fresh = ageDays(a.createdAt) <= FRESH_DAYS;
    if (period === 'fresh' && !fresh) return false;
    if (period === 'stale' && fresh) return false;
    return match(a);
  }), [data, period, match]);
  const openGaps = useMemo(() => (data?.gaps ?? []).filter((g) => g.status === 'open' && match(g)), [data, match]);
  const closedGaps = useMemo(() => (data?.gaps ?? []).filter((g) => g.status !== 'open' && match(g)), [data, match]);
  const staleCount = (data?.areas ?? []).filter((a) => ageDays(a.createdAt) > FRESH_DAYS).length;

  const byRegion = useMemo(() => {
    const m = new Map<string, { region: string | null; captures: number; places: number; openGaps: number; last: string | null }>();
    const get = (r: string | null) => {
      const k = r ?? '—';
      if (!m.has(k)) m.set(k, { region: r, captures: 0, places: 0, openGaps: 0, last: null });
      return m.get(k)!;
    };
    for (const a of data?.areas ?? []) { const e = get(a.region); e.captures++; e.places += a.savedCount; if (!e.last || a.createdAt > e.last) e.last = a.createdAt; }
    for (const g of data?.gaps ?? []) if (g.status === 'open') get(g.region).openGaps++;
    const poi = new Map((data?.regions ?? []).map((r) => [r.region ?? '—', r.total]));
    const bnd = new Map((data?.boundaries ?? []).map((r) => [r.region ?? '—', r.barangays]));
    return [...m.values()].map((e) => ({ ...e, inBsa: poi.get(e.region ?? '—') ?? 0, barangays: e.region ? bnd.get(e.region) ?? 0 : null })).sort((a, b) => b.captures - a.captures);
  }, [data]);

  /** "What to capture next" — the playbook's order: retries, then re-captures due, then missing boundaries. */
  const next = useMemo(() => {
    const out: Array<{ key: string; tone: 'nogo' | 'caution'; title: string; detail: string; href?: string; action: string; code?: string }> = [];
    for (const g of (data?.gaps ?? []).filter((x) => x.status === 'open').sort((a, b) => a.attempts - b.attempts)) {
      out.push({ key: `g${g.id}`, tone: 'nogo', title: `${g.reason === 'limit' ? 'Recapture in smaller rings' : 'Retry'}: ${layerName(g.layer)}`, detail: `${g.label} · ${place(g)}`, href: `/admin/capture?retry=${g.id}`, action: g.reason === 'limit' ? 'Recapture smaller' : 'Retry now' });
    }
    for (const a of (data?.areas ?? []).filter((x) => ageDays(x.createdAt) > FRESH_DAYS).sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
      out.push({ key: `a${a.id}`, tone: 'caution', title: `Re-capture due (${ageDays(a.createdAt)} days)`, detail: `${a.label} · ${place(a)}`, href: `/admin/capture?lat=${a.lat.toFixed(6)}&lon=${a.lon.toFixed(6)}`, action: 'Re-capture' });
    }
    for (const r of byRegion) {
      if (r.region && (r.barangays ?? 0) === 0) {
        const at = (data?.areas ?? []).find((a) => a.region === r.region);
        out.push({ key: `b${r.region}`, tone: 'caution', title: `Barangay boundaries missing: ${regionName(r.region)}`, detail: `${r.captures} capture(s) saved without barangay / city tags. Open Place Capture there — the boundaries load automatically and the saved places get tagged.`, href: at ? `/admin/capture?lat=${at.lat.toFixed(6)}&lon=${at.lon.toFixed(6)}` : undefined, action: 'Load & tag' });
      }
    }
    return out;
  }, [data, byRegion]);
  const win = osm?.window ?? osmWindow();

  /* ---------------------------------------------------------------- map */

  // User-demand points from the DemandPanel, drawn once the map is ready.
  const demandRef = useRef<DemandItem[]>([]);
  const drawDemand = useCallback(() => {
    const src = mapRef.current?.getSource('demand') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: demandRef.current.map((d) => ({
        type: 'Feature' as const,
        properties: { status: d.coverageStatus, what: d.kind === 'search' ? `Search “${d.query ?? ''}”` : `Intake site ${d.label ?? ''}`, statusText: d.coverageStatus === 'gap' ? 'no place data then' : d.coverageStatus === 'partial' ? 'partial data then' : 'covered' },
        geometry: { type: 'Point' as const, coordinates: [d.lon, d.lat] },
      })),
    });
  }, []);
  const showDemand = useCallback((items: DemandItem[]) => { demandRef.current = items; drawDemand(); }, [drawDemand]);
  const focusPoint = useCallback((lat: number, lon: number) => {
    mapRef.current?.flyTo({ center: [lon, lat], zoom: 14, duration: 600 });
    document.getElementById('cov-map')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  useEffect(() => { if (mapReady) drawDemand(); }, [mapReady, drawDemand]);

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
        center: [121.0, 14.4], zoom: 8,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        const go = token('--go', '#5CCB98'), nogo = token('--nogo', '#F28C86'), muted = token('--text-muted', '#9AA7BD'), text = token('--text', '#EDF2FB');
        for (const id of ['cells', 'areas', 'gaps', 'selected', 'pts', 'demand']) map.addSource(id, { type: 'geojson', data: EMPTY_FC });
        map.addLayer({ id: 'cells-fill', type: 'fill', source: 'cells', paint: { 'fill-color': ['case', ['==', ['get', 'fresh'], 1], go, muted], 'fill-opacity': 0.22 } });
        map.addLayer({ id: 'cells-line', type: 'line', source: 'cells', paint: { 'line-color': ['case', ['==', ['get', 'fresh'], 1], go, muted], 'line-width': 0.5, 'line-opacity': 0.6 } });
        map.addLayer({ id: 'areas-fill', type: 'fill', source: 'areas', paint: { 'fill-color': ['case', ['==', ['get', 'fresh'], 1], go, muted], 'fill-opacity': 0.18 } });
        map.addLayer({ id: 'areas-line', type: 'line', source: 'areas', paint: { 'line-color': ['case', ['==', ['get', 'fresh'], 1], go, muted], 'line-width': 1.5 } });
        // Zoomed out, a 1–2 km ring is a few pixels: draw a dot per area / retry entry so nothing gets lost.
        map.addLayer({ id: 'pts-dot', type: 'circle', source: 'pts', maxzoom: 11.5, paint: {
          'circle-radius': 5, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#0E192F',
          'circle-color': ['match', ['get', 'kind'], 'gap', nogo, 'stale', muted, go],
        } });
        map.addLayer({ id: 'gaps-fill', type: 'fill', source: 'gaps', paint: { 'fill-color': nogo, 'fill-opacity': 0.12 } });
        map.addLayer({ id: 'gaps-line', type: 'line', source: 'gaps', paint: { 'line-color': nogo, 'line-width': 2, 'line-dasharray': [2, 1.5] } });
        map.addLayer({ id: 'selected-line', type: 'line', source: 'selected', paint: { 'line-color': text, 'line-width': 3 } });
        // User demand: where users searched / placed intake sites (ringed by the data BSA had there).
        map.addLayer({ id: 'demand-dot', type: 'circle', source: 'demand', paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 3, 13, 6], 'circle-color': token('--projected', '#B39AE8'),
          'circle-stroke-width': 2, 'circle-stroke-color': ['match', ['get', 'status'], 'gap', nogo, 'partial', token('--caution', '#E8B64C'), go],
        } });
        map.on('click', 'demand-dot', (e) => {
          const p = e.features?.[0]?.properties;
          if (p) new maplibregl.Popup({ offset: 8 }).setLngLat(e.lngLat).setText(`${p.what} — ${p.statusText}`).addTo(map);
        });
        setMapReady(true);
      });
      map.on('click', 'areas-fill', (e) => { if (!pickRef.current) { const id = e.features?.[0]?.properties?.id; if (id) setSelected(`a:${id}`); } });
      map.on('click', 'pts-dot', (e) => { if (!pickRef.current) { const p = e.features?.[0]?.properties; if (p?.id) setSelected(`${p.kind === 'gap' ? 'g' : 'a'}:${p.id}`); } });
      map.on('click', 'gaps-fill', (e) => { if (!pickRef.current) { const id = e.features?.[0]?.properties?.id; if (id) setSelected(`g:${id}`); } });
      map.on('click', (e) => {
        if (!pickRef.current) return;
        window.location.href = `/admin/capture?lat=${e.lngLat.lat.toFixed(6)}&lon=${e.lngLat.lng.toFixed(6)}`;
      });
      for (const l of ['areas-fill', 'gaps-fill', 'pts-dot']) {
        map.on('mouseenter', l, () => { if (!pickRef.current) map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', l, () => { if (!pickRef.current) map.getCanvas().style.cursor = ''; });
      }
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  // Areas + open gaps on the map (follow the filters); fit to them once.
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !data) return;
    (map.getSource('areas') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: areas.filter((a) => a.geometry).map((a) => ({ type: 'Feature', properties: { id: a.id, fresh: ageDays(a.createdAt) <= FRESH_DAYS ? 1 : 0 }, geometry: a.geometry! })),
    });
    (map.getSource('gaps') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: openGaps.filter((g) => g.geometry).map((g) => ({ type: 'Feature', properties: { id: g.id }, geometry: g.geometry! })),
    });
    (map.getSource('pts') as maplibregl.GeoJSONSource).setData({
      type: 'FeatureCollection',
      features: [
        ...areas.map((a) => ({ type: 'Feature' as const, properties: { id: a.id, kind: ageDays(a.createdAt) <= FRESH_DAYS ? 'fresh' : 'stale' }, geometry: { type: 'Point' as const, coordinates: [a.lon, a.lat] } })),
        ...openGaps.map((g) => ({ type: 'Feature' as const, properties: { id: g.id, kind: 'gap' }, geometry: { type: 'Point' as const, coordinates: [g.lon, g.lat] } })),
      ],
    });
    if (!fitted.current && (areas.length || openGaps.length)) {
      fitted.current = true;
      const pts = [...areas, ...openGaps];
      let s = 90, w = 180, n = -90, e = -180;
      for (const p of pts) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); }
      map.fitBounds([[w - 0.02, s - 0.02], [e + 0.02, n + 0.02]], { padding: 40, maxZoom: 13, duration: 0 });
    }
  }, [mapReady, data, areas, openGaps]);

  // Selection outline + zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const src = map.getSource('selected') as maplibregl.GeoJSONSource;
    if (!selected) { src.setData(EMPTY_FC); return; }
    const [kind, id] = [selected.slice(0, 1), selected.slice(2)];
    const x = kind === 'a' ? data?.areas.find((a) => a.id === id) : data?.gaps.find((g) => g.id === id);
    if (!x?.geometry) { src.setData(EMPTY_FC); return; }
    src.setData({ type: 'Feature', properties: {}, geometry: x.geometry });
    map.fitBounds(bboxOfGeometry(x.geometry, x.lat, x.lon), { padding: 80, maxZoom: 15, duration: 500 });
    document.getElementById(`cov-${selected.replace(':', '-')}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected, mapReady, data]);

  // Coverage cells for one layer, in the current view.
  const loadCells = useCallback(async () => {
    const map = mapRef.current;
    const src = map?.getSource('cells') as maplibregl.GeoJSONSource | undefined;
    if (!map || !src) return;
    if (!cellLayer) { src.setData(EMPTY_FC); setCellNote(null); return; }
    if (map.getZoom() < 10) { src.setData(EMPTY_FC); setCellNote('Zoom in to see coverage cells.'); return; }
    const b = map.getBounds();
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(4)).join(',');
    const r = await api<Cell[]>(`/api/admin/capture/cells?bbox=${bbox}&layer=${encodeURIComponent(cellLayer)}`);
    if (!r.ok) { setCellNote(r.error.message); return; }
    const h = 0.005;
    src.setData({
      type: 'FeatureCollection',
      features: r.data.map((c) => ({
        type: 'Feature', properties: { fresh: ageDays(c.fetchedAt) <= FRESH_DAYS ? 1 : 0 },
        geometry: { type: 'Polygon', coordinates: [[[c.lon - h, c.lat - h], [c.lon + h, c.lat - h], [c.lon + h, c.lat + h], [c.lon - h, c.lat + h], [c.lon - h, c.lat - h]]] },
      })),
    });
    const fresh = r.data.filter((c) => ageDays(c.fetchedAt) <= FRESH_DAYS).length;
    setCellNote(`${r.data.length.toLocaleString('en-US')} cells in view · ${fresh.toLocaleString('en-US')} fresh · ${(r.data.length - fresh).toLocaleString('en-US')} due`);
  }, [cellLayer]);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    void loadCells();
    const h = () => { void loadCells(); };
    map.on('moveend', h);
    return () => { map.off('moveend', h); };
  }, [mapReady, loadCells]);

  async function gapAction(id: string, action: 'dismiss' | 'reopen') {
    setBusyGap(id);
    const r = await api<{ status: string }>(`/api/admin/capture/gaps/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    setBusyGap(null);
    if (!r.ok) { setErr(r.error.message); return; }
    await load();
  }

  /* ---------------------------------------------------------------- render */

  const t = data?.totals;
  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Saved capture areas" value={t ? t.batches.toLocaleString('en-US') : '—'} />
        <Tile label="New places saved" value={t ? t.places.toLocaleString('en-US') : '—'} />
        <Tile label="Ground covered" value={t ? `${t.areas_km2.toFixed(1)} km²` : '—'} />
        <Tile label="Re-capture due (> 90 days)" value={data ? staleCount.toLocaleString('en-US') : '—'} tone={staleCount ? 'caution' : undefined} />
        <Tile label="Open retries" value={t ? t.openGaps.toLocaleString('en-US') : '—'} tone={t?.openGaps ? 'nogo' : 'go'} />
        <Tile label="Last capture" value={t?.last_at ? stamp(t.last_at) : '—'} />
      </dl>

      {err && <p role="alert" className="card-inset p-3 text-label text-nogo">✕ {err}</p>}

      <div className={`card flex flex-wrap items-center gap-3 px-5 py-3 text-label font-normal ${win.offPeak ? '' : 'border-caution/60'}`} role="status">
        <span className={`rounded-full border px-3 py-1 ${win.offPeak ? 'border-go text-go' : 'border-caution text-caution'}`}>{win.offPeak ? '✓' : '▲'} {win.label}</span>
        <span className="text-ink-muted">{win.advice}</span>
        {osm && <span className="ml-auto text-ink-muted">OpenStreetMap: {!osm.reachable ? 'status unknown' : osm.waitSeconds > 0 ? `next free slot in ${osm.waitSeconds} s` : `${osm.slotsNow ?? 0} slot${osm.slotsNow === 1 ? '' : 's'} free`}</span>}
      </div>

      <section className="card overflow-hidden" aria-labelledby="cov-next-h">
        <div className="px-5 py-4">
          <h2 id="cov-next-h" className="font-body text-title">What to capture next</h2>
          <p className="text-label font-normal text-ink-muted">Retries first, then areas past {FRESH_DAYS} days, then regions missing barangay boundaries (they load automatically in Place Capture). For new ground, pick a spot with no colour on the map below.</p>
        </div>
        <ul className="divide-y divide-ink-border border-t border-ink-border">
          {next.slice(0, 8).map((n) => (
            <li key={n.key} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-label">
              <span aria-hidden className={n.tone === 'nogo' ? 'text-nogo' : 'text-caution'}>{n.tone === 'nogo' ? '✕' : '▲'}</span>
              <span className="min-w-0 flex-1"><span className="text-ink-text">{n.title}</span><span className="block text-ink-muted">{n.detail}</span>{n.code && <code className="mt-1 block break-all text-[12px] text-ink-muted">{n.code}</code>}</span>
              {n.href && <a className="btn-secondary min-h-[32px] px-3 text-label" href={n.href}>{n.action}</a>}
            </li>
          ))}
          {!next.length && <li className="px-5 py-3 text-label text-ink-muted">✓ No retries, nothing overdue, boundaries loaded wherever you captured. Pick an uncaptured spot on the map.</li>}
          {next.length > 8 && <li className="px-5 py-2 text-label text-ink-muted">+ {next.length - 8} more in the retry list and capture log below.</li>}
        </ul>
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 border-b border-ink-border px-5 py-3">
          <label className="text-label"><span className="field-label">Period</span>
            <select className="field mt-1 min-h-[38px] py-1" value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
              <option value="all">All captures</option>
              <option value="fresh">Fresh (last 90 days)</option>
              <option value="stale">Re-capture due (&gt; 90 days)</option>
            </select>
          </label>
          <label className="text-label"><span className="field-label">Region</span>
            <select className="field mt-1 min-h-[38px] py-1" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="all">All regions</option>
              {regionsPresent.map((r) => <option key={r} value={r}>{regionName(r)}</option>)}
            </select>
          </label>
          <label className="text-label"><span className="field-label">Coverage cells for</span>
            <select className="field mt-1 min-h-[38px] py-1" value={cellLayer} onChange={(e) => setCellLayer(e.target.value)}>
              <option value="">— none —</option>
              {(data?.coverageKeys ?? []).map((k) => <option key={k.vertical} value={k.vertical}>{coverageName(k.vertical)} ({k.cells.toLocaleString('en-US')})</option>)}
            </select>
          </label>
          <label className="min-w-[180px] flex-1 text-label"><span className="field-label">Search</span>
            <input className="field mt-1 min-h-[38px] py-1" placeholder="Barangay, city, label…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <button type="button" className={pickMode ? 'btn-primary' : 'btn-secondary'} onClick={() => setPickMode((p) => !p)} aria-pressed={pickMode}>
            {pickMode ? 'Click the map where to capture…' : '+ Capture a new spot'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => void load()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        <div id="cov-map" className="relative h-[56vh] min-h-[400px] scroll-mt-4">
          <div ref={mapEl} className="absolute inset-0 h-full w-full" aria-label="Capture coverage map" role="application" />
          <div className="absolute bottom-3 left-3 z-10 max-w-[280px] rounded-card border border-ink-border bg-ink-panel/95 p-3 text-[12px] text-ink-muted">
            <p className="font-semibold text-ink-text">Legend</p>
            <p><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-go/60 align-middle" />Captured in the last 90 days — skipped by Place Capture</p>
            <p><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-ink-muted/60 align-middle" />Captured &gt; 90 days ago — re-capture due</p>
            <p><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-dashed border-nogo align-middle" />Retry queue — not captured completely</p>
            <p><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-nogo bg-projected align-middle" />User request (ring: red = no data, amber = partial, green = covered)</p>
            <p className="mt-1">No colour = never captured. {cellNote && <span className="block text-ink-text">{cellNote}</span>}</p>
          </div>
        </div>
      </section>

      <DemandPanel onPoints={showDemand} onFocus={focusPoint} />

      <section id="retry" className="card scroll-mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h2 className="font-body text-title">Retry queue</h2>
            <p className="text-label font-normal text-ink-muted">Areas and layers OpenStreetMap did not return completely. Each closes by itself when a saved capture covers it.</p>
          </div>
          <div className="flex gap-1" role="tablist">
            <button type="button" role="tab" aria-selected={gapView === 'open'} className={`rounded-full border px-3 py-1 text-label ${gapView === 'open' ? 'border-accent-soft bg-ink-hover text-ink-text' : 'border-ink-border text-ink-muted'}`} onClick={() => setGapView('open')}>Open ({openGaps.length})</button>
            <button type="button" role="tab" aria-selected={gapView === 'closed'} className={`rounded-full border px-3 py-1 text-label ${gapView === 'closed' ? 'border-accent-soft bg-ink-hover text-ink-text' : 'border-ink-border text-ink-muted'}`} onClick={() => setGapView('closed')}>Closed ({closedGaps.length})</button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-label">
            <thead className="sticky top-0 bg-ink-panel text-ink-muted"><tr>
              <th className="px-5 py-2 text-left font-normal">Area</th><th className="text-left font-normal">Layer</th><th className="text-left font-normal">Why</th>
              <th className="text-right font-normal">Tries</th><th className="px-3 text-left font-normal">{gapView === 'open' ? 'Last try' : 'Closed'}</th><th className="px-5 text-right font-normal">Action</th>
            </tr></thead>
            <tbody>
              {(gapView === 'open' ? openGaps : closedGaps).map((g) => (
                <tr key={g.id} id={`cov-g-${g.id}`} className={`border-t border-ink-border align-top ${selected === `g:${g.id}` ? 'bg-ink-hover' : ''}`}>
                  <td className="px-5 py-2"><button type="button" className="text-left" onClick={() => setSelected(`g:${g.id}`)}><span className="text-ink-text">{g.label}</span><span className="block text-ink-muted">{place(g)} · {regionName(g.region)}</span></button></td>
                  <td className="py-2">{layerName(g.layer)}</td>
                  <td className={`py-2 ${g.reason === 'limit' ? 'text-caution' : 'text-nogo'}`}>{REASON[g.reason]}</td>
                  <td className="py-2 text-right">{g.attempts}</td>
                  <td className="px-3 py-2 text-ink-muted">{gapView === 'open' ? stamp(g.lastAttemptAt) : `${g.status === 'resolved' ? '✓ Captured' : 'Dismissed'}${g.resolvedAt ? ` · ${stamp(g.resolvedAt)}` : ''}`}</td>
                  <td className="whitespace-nowrap px-5 py-2 text-right">
                    {g.status === 'open' && <a className="btn-primary min-h-[32px] px-3 text-label" href={`/admin/capture?retry=${g.id}`}>{g.reason === 'limit' ? 'Recapture smaller' : 'Retry now'}</a>}
                    {g.status === 'open' && <button type="button" className="link ml-3" disabled={busyGap === g.id} onClick={() => gapAction(g.id, 'dismiss')}>Dismiss</button>}
                    {g.status === 'dismissed' && <button type="button" className="link" disabled={busyGap === g.id} onClick={() => gapAction(g.id, 'reopen')}>Re-open</button>}
                  </td>
                </tr>
              ))}
              {!(gapView === 'open' ? openGaps : closedGaps).length && (
                <tr><td colSpan={6} className="px-5 py-4 text-ink-muted">{gapView === 'open' ? '✓ Nothing waiting — every capture loaded completely.' : 'No closed entries yet.'}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="px-5 py-4">
          <h2 className="font-body text-title">Capture log</h2>
          <p className="text-label font-normal text-ink-muted">Every saved capture: where, when, who, which layers loaded completely, and how many new places it added. {areas.length.toLocaleString('en-US')} shown.</p>
        </div>
        <div className="max-h-[560px] overflow-auto">
          <table className="w-full text-label">
            <thead className="sticky top-0 z-10 bg-ink-panel text-ink-muted"><tr>
              <th className="px-5 py-2 text-left font-normal">Saved</th><th className="text-left font-normal">Where</th><th className="text-left font-normal">Layers</th>
              <th className="text-right font-normal">New places</th><th className="px-3 text-left font-normal">Status</th><th className="px-5 text-right font-normal">Action</th>
            </tr></thead>
            <tbody>
              {areas.slice(0, shown).map((a) => {
                const age = ageDays(a.createdAt);
                const missed = a.layers.filter((l) => !a.fetchedLayers.includes(l));
                // Captures saved before per-layer tracking have no fetchedLayers — don't paint them all red.
                const legacy = !a.fetchedLayers.length && a.savedCount > 0;
                return (
                  <tr key={a.id} id={`cov-a-${a.id}`} className={`border-t border-ink-border align-top ${selected === `a:${a.id}` ? 'bg-ink-hover' : ''}`}>
                    <td className="whitespace-nowrap px-5 py-2">{stamp(a.createdAt)}<span className="block text-ink-muted">{a.createdBy ?? (a.label.startsWith('Auto-fill') ? 'Automatic back-fill' : '—')}</span></td>
                    <td className="py-2 pr-3"><button type="button" className="text-left" onClick={() => setSelected(`a:${a.id}`)}><span className="text-ink-text">{a.label}</span><span className="block text-ink-muted">{place(a)} · {regionName(a.region)} · {a.km2} km²</span></button></td>
                    <td className="py-2 pr-3">
                      <ul className="flex flex-wrap gap-1">
                        {a.fetchedLayers.map((l) => <li key={l} className="rounded-full border border-go px-2 py-0.5 text-[12px] text-go">✓ {layerName(l)}</li>)}
                        {legacy && a.layers.map((l) => <li key={l} className="rounded-full border border-ink-border px-2 py-0.5 text-[12px] text-ink-muted" title="Saved before BSA tracked which layers loaded completely">{layerName(l)}</li>)}
                        {!legacy && missed.map((l) => <li key={l} className="rounded-full border border-nogo px-2 py-0.5 text-[12px] text-nogo" title="Asked for but not loaded completely">✕ {layerName(l)}</li>)}
                        {!a.layers.length && <li className="text-ink-muted">{a.source === 'navigator_import' ? 'Field session file' : 'Hand-placed pins'}</li>}
                      </ul>
                    </td>
                    <td className="py-2 text-right">{a.savedCount.toLocaleString('en-US')}</td>
                    <td className={`px-3 py-2 ${age <= FRESH_DAYS ? 'text-go' : 'text-caution'}`}>{age <= FRESH_DAYS ? `Fresh · ${FRESH_DAYS - age} d left` : `Re-capture due (${age} d)`}</td>
                    <td className="whitespace-nowrap px-5 py-2 text-right">
                      <a className="link" href={`/admin/capture?batch=${a.id}`}>Open</a>
                      <a className="link ml-3" href={`/admin/capture?lat=${a.lat.toFixed(6)}&lon=${a.lon.toFixed(6)}`}>{age > FRESH_DAYS || (!legacy && missed.length) ? 'Re-capture' : 'Capture here'}</a>
                    </td>
                  </tr>
                );
              })}
              {!areas.length && <tr><td colSpan={6} className="px-5 py-4 text-ink-muted">{loading ? 'Loading…' : 'No saved captures match these filters.'}</td></tr>}
            </tbody>
          </table>
        </div>
        {areas.length > shown && <div className="border-t border-ink-border px-5 py-2"><button type="button" className="link text-label" onClick={() => setShown((n) => n + 200)}>Show more ({(areas.length - shown).toLocaleString('en-US')} left)</button></div>}
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="card overflow-hidden">
          <div className="px-5 py-4"><h2 className="font-body text-title">By region</h2><p className="text-label font-normal text-ink-muted">Captures saved per region and how many places BSA now holds there.</p></div>
          <table className="w-full text-label">
            <thead className="text-ink-muted"><tr><th className="px-5 py-2 text-left font-normal">Region</th><th className="text-right font-normal">Captures</th><th className="text-right font-normal">New places</th><th className="text-right font-normal">Places in BSA</th><th className="text-right font-normal">Open retries</th><th className="text-right font-normal">Barangay boundaries</th><th className="px-5 text-left font-normal">Last</th></tr></thead>
            <tbody>
              {byRegion.map((r) => (
                <tr key={r.region ?? '—'} className="border-t border-ink-border">
                  <td className="px-5 py-2"><button type="button" className="link text-left" onClick={() => setRegion(r.region ?? 'all')}>{regionName(r.region)}</button></td>
                  <td className="text-right">{r.captures}</td><td className="text-right">{r.places.toLocaleString('en-US')}</td><td className="text-right">{r.inBsa.toLocaleString('en-US')}</td>
                  <td className={`text-right ${r.openGaps ? 'text-nogo' : ''}`}>{r.openGaps}</td>
                  <td className={`text-right ${r.barangays === 0 ? 'text-nogo' : ''}`}>{r.barangays == null ? '—' : r.barangays ? r.barangays.toLocaleString('en-US') : '✕ none'}</td>
                  <td className="px-5 text-ink-muted">{r.last ? stamp(r.last) : '—'}</td>
                </tr>
              ))}
              {!byRegion.length && <tr><td colSpan={7} className="px-5 py-4 text-ink-muted">Nothing captured yet.</td></tr>}
            </tbody>
          </table>
        </section>
        <CapturePlaybook />
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'go' | 'caution' | 'nogo' }) {
  return (
    <div className="card px-4 py-3">
      <dt className="stat-label">{label}</dt>
      <dd className={`text-h3 ${tone === 'nogo' ? 'text-nogo' : tone === 'caution' ? 'text-caution' : tone === 'go' ? 'text-go' : 'text-ink-text'}`}>{value}</dd>
    </div>
  );
}

/** The capture playbook — how to get complete data on the first try (mirrors docs/PLACE_CAPTURE_PLAYBOOK.md). */
function CapturePlaybook() {
  return (
    <section className="card px-5 py-4 text-label font-normal">
      <h2 className="font-body text-title">Capture playbook — complete data on the first try</h2>
      <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-ink-muted">
        <li><strong className="text-ink-text">Check this map first.</strong> Green areas are already captured; Place Capture skips their layers for 90 days. Capture the gaps, not the same spot twice.</li>
        <li><strong className="text-ink-text">Load the region&apos;s barangay boundaries first</strong> so every saved place gets its barangay / city tag.</li>
        <li><strong className="text-ink-text">Keep rings small in dense areas.</strong> 1,500 m is right for towns; use 700–1,000 m in city centres and malls (Makati, Ortigas, BGC, Cebu IT Park). A layer marked “incomplete” hit the place limit — recapture it in smaller rings.</li>
        <li><strong className="text-ink-text">Tick only the business types you need</strong> (2–3 at a time). Each extra layer is one more OpenStreetMap call.</li>
        <li><strong className="text-ink-text">One area at a time, then Save.</strong> Add the next area after the first has finished loading. Don&apos;t refresh the page while layers load.</li>
        <li><strong className="text-ink-text">Let the automatic retries run.</strong> A busy OpenStreetMap is retried twice (after 4 s and 10 s). If it still fails, it lands in the retry queue — come back later, OpenStreetMap is usually free again within minutes.</li>
        <li><strong className="text-ink-text">Off-peak works best.</strong> European night time (early morning to midday Philippine time) is when the public OpenStreetMap servers are least busy.</li>
        <li><strong className="text-ink-text">Save, even if some layers failed.</strong> Everything that loaded is stored and marked covered; only the missed layers stay in the queue.</li>
        <li><strong className="text-ink-text">Use “refresh” sparingly.</strong> Only when you know places changed (new mall, new strip) — it re-asks OpenStreetMap for an area that is still fresh.</li>
        <li><strong className="text-ink-text">Re-capture after 90 days</strong> (grey areas) so Territory Guard keeps seeing new openings and closures.</li>
      </ol>
    </section>
  );
}
