'use client';

/**
 * LocationPicker — an interactive Google-basemap map where the user pins an exact
 * location for an outlet or candidate site. Click to drop, drag to fine-tune, or
 * search an address (server-side geocode). Reports {lat, lon, address} back.
 *
 * Basemap: Google Maps raster tiles via the server proxy (/api/maptiles); falls back
 * to OpenStreetMap if the key is absent. The key never reaches the browser.
 *
 * This closes the intake UX gap: instead of hoping a typed address geocodes, the user
 * drops a pin on the map and sees exactly where their branch/site sits.
 */
import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface PickedLocation { lat: number; lon: number; address?: string }

interface Props {
  title: string;
  initial?: { lat?: number; lon?: number };
  onPick: (loc: PickedLocation) => void;
  onClose: () => void;
}

// Metro Manila default center when nothing is set yet.
const DEFAULT_CENTER = { lat: 14.5547, lon: 121.0244 };

export function LocationPicker({ title, initial, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedLocation | null>(
    initial?.lat && initial?.lon ? { lat: initial.lat, lon: initial.lon } : null,
  );

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    let cancelled = false;

    async function resolveTiles(): Promise<{ tiles: string; attribution: string }> {
      // CDN-backed basemap by default — NOT tile.openstreetmap.org, which throttles (503)
      // under app load and renders a blank map. Override via NEXT_PUBLIC_MAP_TILE_URL.
      const fallback = {
        tiles: process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors © CARTO',
      };
      try {
        const res = await fetch('/api/maptiles');
        const json = await res.json();
        if (json.ok && json.data?.tileUrlTemplate) return { tiles: json.data.tileUrlTemplate, attribution: '© Google' };
      } catch { /* fall through */ }
      return fallback;
    }

    resolveTiles().then((basemap) => {
      if (cancelled || !ref.current || mapRef.current) return;
      const start = picked ?? DEFAULT_CENTER;
      const map = new maplibregl.Map({
        container: ref.current,
        style: { version: 8, sources: { base: { type: 'raster', tiles: [basemap.tiles], tileSize: 256, attribution: basemap.attribution } }, layers: [{ id: 'base', type: 'raster', source: 'base' }] },
        center: [start.lon, start.lat],
        zoom: picked ? 15 : 11,
      });
      mapRef.current = map;

      const setPin = (lat: number, lon: number) => {
        if (!markerRef.current) {
          const el = document.createElement('div');
          el.style.cssText = 'width:16px;height:16px;border-radius:50% 50% 50% 0;background:#e0a568;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.5)';
          markerRef.current = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lon, lat]).addTo(map);
          markerRef.current.on('dragend', () => {
            const p = markerRef.current!.getLngLat();
            setPicked({ lat: round(p.lat), lon: round(p.lng) });
          });
        } else {
          markerRef.current.setLngLat([lon, lat]);
        }
      };

      if (picked) setPin(picked.lat, picked.lon);
      map.on('click', (e) => {
        const lat = round(e.lngLat.lat), lon = round(e.lngLat.lng);
        setPin(lat, lon);
        setPicked({ lat, lon });
      });
    });

    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; markerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch() {
    if (!search.trim()) return;
    setSearching(true);
    setSearchMsg(null);
    const r = await fetch('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: search }) }).then((x) => x.json()).catch(() => null);
    setSearching(false);
    if (!r?.ok || !r.data?.lat) {
      // Address geocoding is off (no live Google calls) — guide the user to pin manually.
      setSearchMsg('Address search is off in database-only mode. Click the map to drop the pin, then drag to fine-tune.');
      return;
    }
    if (r?.ok && r.data?.lat) {
      const lat = r.data.lat, lon = r.data.lon;
      setPicked({ lat, lon, address: r.data.formattedAddress });
      const map = mapRef.current;
      if (map) {
        map.flyTo({ center: [lon, lat], zoom: 15 });
        if (!markerRef.current) {
          const el = document.createElement('div');
          el.style.cssText = 'width:16px;height:16px;border-radius:50% 50% 50% 0;background:#e0a568;border:2px solid #fff;transform:rotate(-45deg);box-shadow:0 1px 4px rgba(0,0,0,.5)';
          markerRef.current = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lon, lat]).addTo(map);
          markerRef.current.on('dragend', () => { const p = markerRef.current!.getLngLat(); setPicked({ lat: round(p.lat), lon: round(p.lng) }); });
        } else {
          markerRef.current.setLngLat([lon, lat]);
        }
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-ink-border bg-ink-panel p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-text">{title}</p>
          <button onClick={onClose} className="text-ink-muted hover:text-ink-text">✕</button>
        </div>
        <div className="mb-3 flex gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && doSearch()}
            placeholder="Click the map to drop the pin (address search off in DB-only mode)"
            className="field flex-1 px-3 py-2 text-sm"
          />
          <button onClick={doSearch} disabled={searching} className="btn-ghost text-sm">{searching ? 'Searching…' : 'Search'}</button>
        </div>
        {searchMsg && <p className="mb-2 text-xs text-caution">{searchMsg}</p>}
        <div ref={ref} className="h-[360px] w-full overflow-hidden rounded-xl border border-ink-border" />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-ink-muted">
            {picked ? <>Pinned: <span className="text-go">{picked.lat}, {picked.lon}</span></> : 'Click the map or search to drop a pin.'}
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost text-sm">Cancel</button>
            <button
              onClick={() => { if (picked) { onPick(picked); onClose(); } }}
              disabled={!picked}
              className="btn-accent text-sm disabled:opacity-50"
            >
              Use this location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
