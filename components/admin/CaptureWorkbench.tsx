'use client';

/**
 * Admin Place Capture — grid-navigator's capture loop, blended into BSA (2026-10-07).
 *
 *   draw an area (rectangle / circle) or drop a pin  →  pull from OpenStreetMap (server-side)
 *   or import a Grid Navigator session file          →  review (accept / reject / fix)  →  commit to BSA
 *
 * The browser never calls OpenStreetMap or the database: everything goes through the admin-only
 * /api/admin/capture/* routes. Nothing reaches the shared places table until an admin commits.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { defaultBasemapUrl, basemapPaint, OSM_ATTRIBUTION, OSM_MAX_ZOOM } from '@/lib/ui/theme';
import { listRegions } from '@/lib/geo/regions';
import { BASE_LAYERS, VERTICAL_LAYERS, type LayerKey } from '@/lib/capture/layers';
import { areaGeoJson, areaKm2, MAX_CAPTURE_KM2, type CaptureArea } from '@/lib/capture/area';
import { BSA_POI_CATEGORIES, CATEGORY_LABEL, type BsaPoiCategory } from '@/lib/places/osmCategory';
import { TruthChip } from '@/components/ui/Chips';

type Tool = 'pan' | 'rect' | 'circle' | 'pin';
type Decision = 'accept' | 'reject' | 'pending';

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
interface BatchDetail {
  batch: BatchSummary & { notes: string | null; areaSpec: CaptureArea | null; layers: string[] };
  counts: { accept: number; reject: number; pending: number; existing: number; duplicates: number };
  items: Item[];
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

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] as GeoJSON.Feature[] };
const PAGE = 200;
const REGIONS = listRegions();

export function CaptureWorkbench() {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [tool, setTool] = useState<Tool>('pan');
  const toolRef = useRef<Tool>('pan');
  const [area, setArea] = useState<CaptureArea | null>(null);
  const rectStart = useRef<{ lat: number; lon: number } | null>(null);
  const [radiusM, setRadiusM] = useState(800);
  const radiusRef = useRef(800);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);

  const [layers, setLayers] = useState<LayerKey[]>(['anchors', 'transport', 'health', 'education']);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [filter, setFilter] = useState<'all' | Decision | 'existing' | 'duplicates'>('all');
  const [search, setSearch] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmCommit, setConfirmCommit] = useState(false);
  const [showCoverage, setShowCoverage] = useState(true);
  const [regionTotals, setRegionTotals] = useState<Array<{ region: string | null; total: number; manual: number; verified: number; tagged: number }>>([]);

  useEffect(() => { toolRef.current = tool; if (tool !== 'rect') rectStart.current = null; }, [tool]);

  /* ---------------------------------------------------------------- data */

  const loadBatches = useCallback(async () => {
    const r = await api<BatchSummary[]>('/api/admin/capture/batches');
    if (r.ok) setBatches(r.data);
  }, []);

  const loadBatch = useCallback(async (id: string) => {
    const r = await api<BatchDetail>(`/api/admin/capture/batches/${id}`);
    if (r.ok) { setDetail(r.data); setShown(PAGE); setConfirmCommit(false); }
    else setMsg({ tone: 'err', text: r.error.message });
  }, []);

  const loadCoverage = useCallback(async () => {
    const r = await api<{ areas: Array<{ id: string; label: string; geometry: GeoJSON.Geometry | null }>; regions: typeof regionTotals }>('/api/admin/capture/coverage');
    if (!r.ok) return;
    setRegionTotals(r.data.regions);
    const src = mapRef.current?.getSource('coverage') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: r.data.areas.filter((a) => a.geometry).map((a) => ({ type: 'Feature', properties: { label: a.label }, geometry: a.geometry! })),
    });
  }, []);

  const loadExisting = useCallback(async () => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource('existing') as maplibregl.GeoJSONSource | undefined;
    if (!src) return;
    if (map.getZoom() < 13) { src.setData(EMPTY_FC); return; }
    const b = map.getBounds();
    const bbox = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map((n) => n.toFixed(5)).join(',');
    const r = await api<Array<{ id: string; name: string; category: string; lat: number; lon: number }>>(`/api/admin/capture/pois?bbox=${bbox}`);
    if (!r.ok) return;
    src.setData({ type: 'FeatureCollection', features: r.data.map((p) => ({ type: 'Feature', properties: { name: p.name }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) });
  }, []);

  /* ---------------------------------------------------------------- map */

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
        const accent = token('--accent-text', '#E2B985');
        for (const id of ['coverage', 'area', 'existing', 'items']) map.addSource(id, { type: 'geojson', data: EMPTY_FC });
        map.addLayer({ id: 'coverage-fill', type: 'fill', source: 'coverage', paint: { 'fill-color': token('--projected', '#B39AE8'), 'fill-opacity': 0.08 } });
        map.addLayer({ id: 'coverage-line', type: 'line', source: 'coverage', paint: { 'line-color': token('--projected', '#B39AE8'), 'line-width': 1.5, 'line-dasharray': [2, 2] } });
        map.addLayer({ id: 'area-fill', type: 'fill', source: 'area', paint: { 'fill-color': accent, 'fill-opacity': 0.12 } });
        map.addLayer({ id: 'area-line', type: 'line', source: 'area', paint: { 'line-color': accent, 'line-width': 2 } });
        map.addLayer({ id: 'existing-dot', type: 'circle', source: 'existing', paint: { 'circle-radius': 3, 'circle-color': token('--text-muted', '#A9B6CE'), 'circle-opacity': 0.7 } });
        map.addLayer({
          id: 'items-dot', type: 'circle', source: 'items',
          paint: {
            'circle-radius': ['case', ['==', ['get', 'selected'], 1], 9, 6],
            'circle-color': ['match', ['get', 'decision'], 'accept', token('--go', '#5CCB98'), 'pending', token('--caution', '#E8B64C'), token('--nogo', '#F28C86')],
            // Rejected = hollow ring, so status never relies on colour alone.
            'circle-opacity': ['match', ['get', 'decision'], 'reject', 0, 0.95],
            'circle-stroke-color': ['match', ['get', 'decision'], 'reject', token('--nogo', '#F28C86'), token('--bg', '#0E192F')],
            'circle-stroke-width': 2,
          },
        });
        setMapReady(true);
      });
      map.on('moveend', () => { void loadExisting(); });
      map.on('click', 'items-dot', (e) => {
        const id = e.features?.[0]?.properties?.id;
        if (id && toolRef.current === 'pan') setSelected(String(id));
      });
      map.on('click', (e) => {
        const lat = e.lngLat.lat, lon = e.lngLat.lng;
        const t = toolRef.current;
        if (t === 'rect') {
          if (!rectStart.current) { rectStart.current = { lat, lon }; setArea(null); }
          else {
            const a = rectStart.current;
            rectStart.current = null;
            setArea({ kind: 'rect', south: Math.min(a.lat, lat), north: Math.max(a.lat, lat), west: Math.min(a.lon, lon), east: Math.max(a.lon, lon) });
            setTool('pan');
          }
        } else if (t === 'circle') {
          setArea({ kind: 'circle', lat: round6(lat), lon: round6(lon), radiusM: radiusRef.current });
        } else if (t === 'pin') {
          setPin({ lat: round6(lat), lon: round6(lon) });
        }
      });
      map.on('mousemove', (e) => {
        if (toolRef.current !== 'rect' || !rectStart.current) return;
        const a = rectStart.current;
        const live: CaptureArea = { kind: 'rect', south: Math.min(a.lat, e.lngLat.lat), north: Math.max(a.lat, e.lngLat.lat), west: Math.min(a.lon, e.lngLat.lng), east: Math.max(a.lon, e.lngLat.lng) };
        (map.getSource('area') as maplibregl.GeoJSONSource | undefined)?.setData({ type: 'Feature', properties: {}, geometry: areaGeoJson(live) });
      });
    })();
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
    // Mount-only: builds the maplibre instance once (handlers read live state through refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    radiusRef.current = radiusM;
    setArea((a) => (a && a.kind === 'circle' ? { ...a, radiusM } : a));
  }, [radiusM]);

  // Draw the current area.
  useEffect(() => {
    if (!mapReady) return;
    const src = mapRef.current?.getSource('area') as maplibregl.GeoJSONSource | undefined;
    src?.setData(area ? { type: 'Feature', properties: {}, geometry: areaGeoJson(area) } : EMPTY_FC);
  }, [area, mapReady]);

  // Draw staged items.
  useEffect(() => {
    if (!mapReady) return;
    const src = mapRef.current?.getSource('items') as maplibregl.GeoJSONSource | undefined;
    src?.setData({
      type: 'FeatureCollection',
      features: (detail?.items ?? []).map((it) => ({
        type: 'Feature',
        properties: { id: it.id, decision: it.decision, selected: it.id === selected ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [it.lon, it.lat] },
      })),
    });
  }, [detail, selected, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.setLayoutProperty('coverage-fill', 'visibility', showCoverage ? 'visible' : 'none');
    mapRef.current?.setLayoutProperty('coverage-line', 'visibility', showCoverage ? 'visible' : 'none');
  }, [showCoverage, mapReady]);

  useEffect(() => { if (mapReady) { void loadBatches(); void loadCoverage(); void loadExisting(); } }, [mapReady, loadBatches, loadCoverage, loadExisting]);

  // Selecting a row flies to it; selecting a dot scrolls its row into view.
  useEffect(() => {
    if (!selected || !detail) return;
    const it = detail.items.find((i) => i.id === selected);
    if (!it) return;
    document.getElementById(`cap-row-${selected}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, detail]);

  /* ---------------------------------------------------------------- actions */

  const km2 = area ? areaKm2(area) : 0;
  const tooBig = km2 > MAX_CAPTURE_KM2;

  async function capture() {
    if (!area || tooBig || !layers.length) return;
    setBusy('Pulling places from OpenStreetMap…'); setMsg(null);
    const r = await api<{ batchId: string; staged: number; notes: string[] }>('/api/admin/capture/preview', jsonInit('POST', { area, layers, label: label.trim() || undefined }));
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    setMsg({ tone: 'ok', text: `${r.data.staged} places staged for review. Nothing is saved until you commit.` });
    await loadBatch(r.data.batchId); await loadBatches();
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
    setMsg({ tone: 'ok', text: `${r.data.staged} places staged from the session file.` });
    await loadBatch(r.data.batchId); await loadBatches();
  }

  async function savePin(form: { name: string; category: BsaPoiCategory; notes: string }) {
    if (!pin) return;
    const draftId = detail?.batch.status === 'draft' ? detail.batch.id : undefined;
    setBusy('Adding pin…');
    const r = await api<{ batchId: string }>('/api/admin/capture/manual', jsonInit('POST', { ...pin, ...form, notes: form.notes || undefined, batchId: draftId }));
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    setPin(null);
    setMsg({ tone: 'ok', text: 'Pin staged. Commit the batch to save it.' });
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
    setBusy('Saving to BSA…'); setMsg(null);
    const r = await api<{ committed: number; psgcTagged: number; skippedExisting: number }>(`/api/admin/capture/batches/${detail.batch.id}/commit`, { method: 'POST' });
    setBusy(null); setConfirmCommit(false);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    const untagged = r.data.committed - r.data.psgcTagged;
    setMsg({ tone: 'ok', text: `Saved ${r.data.committed} places to BSA.${untagged > 0 ? ` ${untagged} have no barangay yet (boundaries not loaded there).` : ''}${r.data.skippedExisting ? ` ${r.data.skippedExisting} were already in BSA and left unchanged.` : ''}` });
    await loadBatch(detail.batch.id); await loadBatches(); await loadCoverage(); await loadExisting();
  }

  async function discard() {
    if (!detail) return;
    const r = await api(`/api/admin/capture/batches/${detail.batch.id}`, { method: 'DELETE' });
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    setDetail(null); await loadBatches();
  }

  function flyTo(lat: number, lon: number, zoom = 13) { mapRef.current?.flyTo({ center: [lon, lat], zoom }); }

  /* ---------------------------------------------------------------- review list */

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (detail?.items ?? []).filter((it) => {
      if (filter === 'existing' && !it.existingPoiId) return false;
      if (filter === 'duplicates' && !it.duplicateOfPoiId) return false;
      if ((filter === 'accept' || filter === 'reject' || filter === 'pending') && it.decision !== filter) return false;
      return !q || it.name.toLowerCase().includes(q) || (it.kind ?? '').includes(q);
    });
  }, [detail, filter, search]);
  const editable = detail?.batch.status === 'draft';

  /* ---------------------------------------------------------------- render */

  return (
    <div className="grid gap-5 xl:grid-cols-[400px_minmax(0,1fr)]">
      {/* ------------------------------------------------ control panel */}
      <div className="flex min-w-0 flex-col gap-4">
        <section className="card p-5" aria-labelledby="cap-area">
          <h2 id="cap-area" className="font-body text-title">1 · Pick an area</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {REGIONS.map((r) => (
              <button key={r.key} type="button" className="btn-secondary min-h-[36px] px-3 text-label" onClick={() => flyTo(r.warmCentres[0].lat, r.warmCentres[0].lon, 12)}>{r.name}</button>
            ))}
          </div>
          <div role="radiogroup" aria-label="Map tool" className="mt-4 grid grid-cols-4 gap-2">
            {([['pan', 'Move'], ['rect', 'Rectangle'], ['circle', 'Circle'], ['pin', 'Pin']] as Array<[Tool, string]>).map(([t, l]) => (
              <button key={t} type="button" role="radio" aria-checked={tool === t} onClick={() => setTool(t)}
                className={`btn min-h-[40px] px-2 text-label ${tool === t ? 'bg-ink-hover font-semibold text-ink-text shadow-[inset_0_-2px_0_#BE8562]' : 'border border-ink-border-strong text-ink-muted'}`}>{l}</button>
            ))}
          </div>
          <p className="field-help mt-2">
            {tool === 'rect' && 'Click one corner, then the opposite corner.'}
            {tool === 'circle' && 'Click the centre, then set the radius below.'}
            {tool === 'pin' && 'Click the exact spot of a place that is missing from the map.'}
            {tool === 'pan' && 'Drag to move, scroll to zoom. Grey dots are places already in BSA (zoom in to see them).'}
          </p>
          {(tool === 'circle' || area?.kind === 'circle') && (
            <label className="mt-3 block">
              <span className="field-label">Radius: {radiusM.toLocaleString('en-US')} m</span>
              <input type="range" min={100} max={2800} step={50} value={radiusM} onChange={(e) => setRadiusM(Number(e.target.value))} className="mt-1 w-full" />
            </label>
          )}
          {area && (
            <p className={`mt-3 text-label font-normal ${tooBig ? 'text-nogo' : 'text-ink-muted'}`} role="status">
              {tooBig ? '✕ ' : ''}Area ≈ {km2.toFixed(2)} km²{tooBig ? ` — over the ${MAX_CAPTURE_KM2} km² limit per capture. Draw a smaller area.` : ''}
              <button type="button" className="link ml-2" onClick={() => setArea(null)}>Clear</button>
            </p>
          )}
        </section>

        {pin && <PinForm pin={pin} busy={!!busy} onCancel={() => setPin(null)} onSave={savePin} />}

        <section className="card p-5" aria-labelledby="cap-layers">
          <h2 id="cap-layers" className="font-body text-title">2 · What to capture</h2>
          <fieldset className="mt-3 space-y-2">
            <legend className="sr-only">Place layers</legend>
            {BASE_LAYERS.map((l) => (
              <LayerCheck key={l.key} k={l.key} label={l.label} hint={l.hint} checked={layers.includes(l.key)} onChange={(on) => setLayers((ls) => on ? [...ls, l.key] : ls.filter((x) => x !== l.key))} />
            ))}
          </fieldset>
          <details className="mt-3">
            <summary className="cursor-pointer text-label text-ink-muted">Franchise competitor sets ({VERTICAL_LAYERS.filter((l) => layers.includes(l.key)).length} selected)</summary>
            <fieldset className="mt-2 space-y-2">
              <legend className="sr-only">Competitor sets</legend>
              {VERTICAL_LAYERS.map((l) => (
                <LayerCheck key={l.key} k={l.key} label={l.label} hint={l.hint} checked={layers.includes(l.key)} onChange={(on) => setLayers((ls) => on ? [...ls, l.key].slice(0, 12) : ls.filter((x) => x !== l.key))} />
              ))}
            </fieldset>
          </details>
          <label className="mt-4 block">
            <span className="field-label">Batch name (optional)</span>
            <input className="field mt-1" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Santa Rosa – Nuvali anchors" />
          </label>
          <button type="button" className="btn-primary mt-4 w-full" disabled={!area || tooBig || !layers.length || !!busy} onClick={capture}>
            {busy ?? 'Capture this area'}
          </button>
          <div className="mt-4 border-t border-ink-border pt-4">
            <span className="field-label">Or import a Grid Navigator session</span>
            <input type="file" accept=".json,application/json" className="mt-2 block w-full text-label text-ink-muted" disabled={!!busy}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
            <p className="field-help mt-1">Save the session in Grid Navigator <em>without</em> map tiles (10 MB max). Its places and checkpoints are staged for review.</p>
          </div>
        </section>

        {msg && <p role="status" className={`card-inset p-3 text-label font-normal ${msg.tone === 'err' ? 'text-nogo' : 'text-ink-text'}`}>{msg.tone === 'err' ? '✕ ' : '✓ '}{msg.text}</p>}

        <section className="card p-5" aria-labelledby="cap-batches">
          <div className="flex items-center justify-between">
            <h2 id="cap-batches" className="font-body text-title">Capture history</h2>
            <label className="flex items-center gap-2 text-label text-ink-muted">
              <input type="checkbox" checked={showCoverage} onChange={(e) => setShowCoverage(e.target.checked)} /> Show coverage
            </label>
          </div>
          <ul className="mt-3 max-h-[280px] space-y-1 overflow-y-auto">
            {batches.length === 0 && <li className="text-label text-ink-muted">No captures yet.</li>}
            {batches.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => loadBatch(b.id)} className={`nav-item w-full text-left ${detail?.batch.id === b.id ? 'nav-item-active' : ''}`}>
                  <span className="min-w-0 flex-1 truncate">{b.label}</span>
                  <span className="shrink-0 text-chip uppercase text-ink-muted">{b.status === 'committed' ? `✓ ${b.committedCount}` : b.status === 'draft' ? `draft · ${b.itemCount}` : 'discarded'}</span>
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
      </div>

      {/* ------------------------------------------------ map + review */}
      <div className="flex min-w-0 flex-col gap-4">
        <div className="relative h-[60vh] min-h-[420px] overflow-hidden rounded-card border border-ink-border">
          <div ref={mapEl} className="absolute inset-0 h-full w-full" aria-label="Capture map" role="application" />
          <ul className="absolute bottom-3 left-3 space-y-1 rounded-control bg-ink-panel/90 px-3 py-2 text-label text-ink-text shadow-e1">
            <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full bg-go" /> Will be saved</li>
            <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full bg-caution" /> Needs a decision</li>
            <li className="flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-full border-2 border-nogo" /> Rejected</li>
            <li className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-ink-muted" /> Already in BSA</li>
          </ul>
        </div>

        {detail && (
          <section className="card p-5" aria-labelledby="cap-review">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="cap-review" className="font-body text-title">3 · Review &amp; save — {detail.batch.label}</h2>
                <p className="mt-1 text-label font-normal text-ink-muted">
                  {detail.items.length.toLocaleString('en-US')} places · {detail.counts.accept} to save · {detail.counts.pending} need a decision · {detail.counts.reject} rejected · {detail.counts.existing} already in BSA · status: <strong className="text-ink-text">{detail.batch.status}</strong>
                </p>
              </div>
              {editable && (
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary" onClick={discard} disabled={!!busy}>Discard</button>
                  {!confirmCommit
                    ? <button type="button" className="btn-primary" disabled={detail.counts.pending > 0 || detail.counts.accept === 0 || !!busy} onClick={() => setConfirmCommit(true)}>Save {detail.counts.accept} to BSA</button>
                    : <span className="flex items-center gap-2"><span className="text-label">Save {detail.counts.accept} places for every BSA user?</span><button type="button" className="btn-primary" onClick={commit} disabled={!!busy}>{busy ?? 'Yes, save'}</button><button type="button" className="btn-secondary" onClick={() => setConfirmCommit(false)}>Cancel</button></span>}
                </div>
              )}
            </div>
            {detail.counts.pending > 0 && editable && <p className="mt-2 text-label font-normal text-caution">▲ {detail.counts.pending} item(s) need a decision before you can save — possible duplicates of places already in BSA, or pins without a category.</p>}
            {detail.batch.notes && <p className="mt-2 whitespace-pre-line text-label font-normal text-ink-muted">{detail.batch.notes}</p>}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <select aria-label="Filter" className="field min-h-[40px] w-auto" value={filter} onChange={(e) => { setFilter(e.target.value as typeof filter); setShown(PAGE); }}>
                <option value="all">All</option><option value="accept">To save</option><option value="pending">Needs decision</option>
                <option value="reject">Rejected</option><option value="existing">Already in BSA</option><option value="duplicates">Possible duplicates</option>
              </select>
              <input aria-label="Search names" className="field min-h-[40px] w-48" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {editable && visible.length > 0 && (
                <>
                  <button type="button" className="btn-secondary min-h-[40px] text-label" onClick={() => patchItems(visible.map((i) => ({ id: i.id, decision: 'accept' })))}>Accept all shown</button>
                  <button type="button" className="btn-secondary min-h-[40px] text-label" onClick={() => patchItems(visible.map((i) => ({ id: i.id, decision: 'reject' })))}>Reject all shown</button>
                </>
              )}
            </div>

            <div className="mt-3 max-h-[480px] overflow-auto">
              <table className="w-full text-label">
                <caption className="sr-only">Staged places</caption>
                <thead className="sticky top-0 bg-ink-panel text-ink-muted">
                  <tr><th className="py-2 text-left font-normal">Place</th><th className="text-left font-normal">Category</th><th className="text-left font-normal">Truth</th><th className="text-left font-normal">Status</th>{editable && <th className="text-left font-normal">Decision</th>}</tr>
                </thead>
                <tbody>
                  {visible.slice(0, shown).map((it) => (
                    <tr key={it.id} id={`cap-row-${it.id}`} className={`border-t border-ink-border align-top ${selected === it.id ? 'bg-ink-hover' : ''}`}>
                      <td className="py-2 pr-2">
                        <button type="button" className="text-left text-ink-text hover:underline" onClick={() => { setSelected(it.id); flyTo(it.lat, it.lon, 17); }}>{it.name}</button>
                        <div className="text-label font-normal text-ink-muted">{it.kind ?? 'manual pin'}{it.osmRef ? ` · ${it.osmRef}` : ''}{it.notes ? ` · ${it.notes}` : ''}</div>
                      </td>
                      <td className="pr-2">
                        {editable && !it.committedPoiId
                          ? <select aria-label={`Category for ${it.name}`} className="rounded-control border border-ink-border-strong bg-ink-panel-2 px-2 py-1" value={it.category} onChange={(e) => patchItems([{ id: it.id, category: e.target.value as BsaPoiCategory }])}>
                              {BSA_POI_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                            </select>
                          : CATEGORY_LABEL[it.category]}
                      </td>
                      <td className="pr-2"><TruthChip layer={it.truthLayer} compact /></td>
                      <td className="pr-2 text-ink-muted">
                        {it.committedPoiId ? '✓ saved' : it.existingPoiId ? 'In BSA — refresh' : it.duplicateOfPoiId ? '▲ possible duplicate' : 'new'}
                      </td>
                      {editable && (
                        <td>
                          <div role="radiogroup" aria-label={`Decision for ${it.name}`} className="flex gap-1">
                            {(['accept', 'reject'] as const).map((d) => (
                              <button key={d} type="button" role="radio" aria-checked={it.decision === d} disabled={!!it.committedPoiId}
                                onClick={() => patchItems([{ id: it.id, decision: d }])}
                                className={`rounded-control border px-2 py-1 ${it.decision === d ? (d === 'accept' ? 'border-go text-go' : 'border-nogo text-nogo') : 'border-ink-border text-ink-muted'}`}>
                                {d === 'accept' ? '✓ Save' : '✕ Skip'}
                              </button>
                            ))}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length > shown && <button type="button" className="btn-secondary mt-3" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, visible.length - shown)} more of {visible.length - shown}</button>}
              {visible.length === 0 && <p className="py-4 text-label text-ink-muted">Nothing matches this filter.</p>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function LayerCheck({ k, label, hint, checked, onChange }: { k: string; label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3" htmlFor={`layer-${k}`}>
      <input id={`layer-${k}`} type="checkbox" className="mt-1" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="text-body text-ink-text">{label}</span><span className="block text-label font-normal text-ink-muted">{hint}</span></span>
    </label>
  );
}

function PinForm({ pin, busy, onCancel, onSave }: { pin: { lat: number; lon: number }; busy: boolean; onCancel: () => void; onSave: (f: { name: string; category: BsaPoiCategory; notes: string }) => void }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState<BsaPoiCategory>('anchor');
  const [notes, setNotes] = useState('');
  return (
    <section className="card p-5" aria-labelledby="cap-pin">
      <h2 id="cap-pin" className="font-body text-title">Add a place by hand</h2>
      <p className="field-help mt-1">At {pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}. Saved as <strong>Assumed</strong> until an admin confirms it on the ground.</p>
      <label className="mt-3 block"><span className="field-label">Name</span><input className="field mt-1" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="mt-3 block"><span className="field-label">Category</span>
        <select className="field mt-1" value={category} onChange={(e) => setCategory(e.target.value as BsaPoiCategory)}>
          {BSA_POI_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
        </select>
      </label>
      <label className="mt-3 block"><span className="field-label">Notes (optional)</span><input className="field mt-1" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="mt-4 flex gap-2">
        <button type="button" className="btn-primary" disabled={!name.trim() || busy} onClick={() => onSave({ name: name.trim(), category, notes: notes.trim() })}>Stage pin</button>
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </section>
  );
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
