'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { geoCircle, VERDICT_COLOR } from '@/lib/geo/mapGeometry';

export interface MapOutlet {
  id: string;
  name: string;
  lat: number;
  lon: number;
  catchmentM: number;
}
export interface MapCandidate {
  id: string;
  label: string;
  lat: number;
  lon: number;
  catchmentM: number;
  verdict?: 'adds' | 'mixed' | 'redistributes';
}
export interface MapCompetitor {
  name: string;
  lat: number;
  lon: number;
  /**
   * Vertical-relevance tier. Optional so older callers/payloads keep working — an
   * untiered point is treated as 'direct', which is how the map behaved before tiering.
   */
  tier?: 'direct' | 'adjacent' | 'unrelated';
  /** categorizeByName key (e.g. "qsr", "fitness") — shown in the popup for context. */
  category?: string;
}

/**
 * Dot styling per tier. Direct rivals are loud, adjacent formats are muted, and unrelated
 * businesses are deliberately faint: they are drawn only so the user can read how built-up
 * the corridor is, and the popup says plainly that they are NOT competitors.
 */
const TIER_STYLE = {
  direct: { size: 11, fill: '#E0655A', border: '#fff', opacity: 1, label: 'Direct competitor' },
  adjacent: { size: 9, fill: '#A98B54', border: '#fff', opacity: 0.9, label: 'Adjacent — sells similar, different format' },
  unrelated: { size: 6, fill: '#6B7A8C', border: 'rgba(255,255,255,.55)', opacity: 0.5, label: 'Nearby business — not a competitor' },
} as const;

/** circle() and VERDICT_COLOR now live in lib/geo/mapGeometry (pure, unit-tested). */
const circle = geoCircle;

/**
 * Territory Guard map — dashed catchment rings for each existing outlet, the
 * candidate ring overlaid, coloured by verdict.
 *
 * Basemap: OpenStreetMap raster tiles (free) by default. Google Maps tiles are used
 * only when live maps are explicitly enabled (PLACES_LIVE) via the server-side
 * /api/maptiles proxy. All plotted points — the candidate, own outlets, and nearby
 * competitors — come from database coordinates, so nothing here costs an API call.
 */
export function TerritoryMap({ outlets, candidate, competitors = [] }: { outlets: MapOutlet[]; candidate: MapCandidate; competitors?: MapCompetitor[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    let cancelled = false;

    /**
     * Prefer Google Maps tiles (via our server proxy) when configured; otherwise use a
     * CDN-backed basemap. We deliberately do NOT default to tile.openstreetmap.org — that
     * is OSM's donated server with a strict no-bulk-use policy, and it returns HTTP 503
     * (throttled) under normal app load, which shows as a BLANK map. Carto's basemaps are
     * CDN-hosted, free with attribution, app-tolerant, and the dark theme matches our UI.
     * Override with NEXT_PUBLIC_MAP_TILE_URL if you have your own tile source.
     */
    async function resolveTiles(): Promise<{ tiles: string; attribution: string }> {
      const fallback = {
        tiles: process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors © CARTO',
      };
      try {
        const res = await fetch('/api/maptiles');
        const json = await res.json();
        if (json.ok && json.data?.tileUrlTemplate) {
          return { tiles: json.data.tileUrlTemplate, attribution: '© Google' };
        }
      } catch {
        /* fall through to the CDN basemap */
      }
      return fallback;
    }

    resolveTiles().then((basemap) => {
      if (cancelled || !ref.current || mapRef.current) return;
      buildMap(basemap.tiles, basemap.attribution);
    });

    function buildMap(tileUrl: string, attribution: string) {
    const map = new maplibregl.Map({
      container: ref.current!,
      style: {
        version: 8,
        sources: {
          osm: { type: 'raster', tiles: [tileUrl], tileSize: 256, attribution },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [candidate.lon, candidate.lat],
      zoom: 12,
    });
    mapRef.current = map;

    map.on('load', () => {
      // Outlet catchments (dashed).
      const outletFeatures = outlets.map((o) => circle(o.lon, o.lat, o.catchmentM));
      map.addSource('outlet-rings', { type: 'geojson', data: { type: 'FeatureCollection', features: outletFeatures } });
      map.addLayer({
        id: 'outlet-rings-line',
        type: 'line',
        source: 'outlet-rings',
        paint: { 'line-color': '#193B4D', 'line-width': 1.5, 'line-dasharray': [2, 2] },
      });

      // Candidate catchment (filled, verdict-coloured).
      const color = VERDICT_COLOR[candidate.verdict ?? 'mixed'];
      map.addSource('candidate-ring', { type: 'geojson', data: circle(candidate.lon, candidate.lat, candidate.catchmentM) });
      map.addLayer({
        id: 'candidate-ring-fill',
        type: 'fill',
        source: 'candidate-ring',
        paint: { 'fill-color': color, 'fill-opacity': 0.18 },
      });
      map.addLayer({
        id: 'candidate-ring-line',
        type: 'line',
        source: 'candidate-ring',
        paint: { 'line-color': color, 'line-width': 2 },
      });

      // Nearby establishments (coordinates from the database), styled and labelled by
      // relevance tier. Drawn unrelated-first so direct rivals end up on TOP of the stack
      // and are never hidden behind a context dot.
      const ordered = [...competitors].sort(
        (a, b) => (TIER_STYLE[b.tier ?? 'direct'].size) - (TIER_STYLE[a.tier ?? 'direct'].size),
      );
      for (const c of ordered) {
        const tier = c.tier ?? 'direct';
        const s = TIER_STYLE[tier];
        const el = document.createElement('div');
        el.style.cssText =
          `width:${s.size}px;height:${s.size}px;border-radius:50%;background:${s.fill};` +
          `border:1.5px solid ${s.border};opacity:${s.opacity};box-shadow:0 0 2px rgba(0,0,0,.4)`;
        const suffix = c.category && c.category !== 'other' ? ` · ${c.category.replace(/_/g, ' ')}` : '';
        new maplibregl.Marker({ element: el })
          .setLngLat([c.lon, c.lat])
          .setPopup(new maplibregl.Popup({ offset: 8 }).setText(`${c.name} — ${s.label}${suffix}`))
          .addTo(map);
      }

      // Own outlets (nile blue) + candidate (verdict colour).
      for (const o of outlets) {
        new maplibregl.Marker({ color: '#193B4D' })
          .setLngLat([o.lon, o.lat])
          .setPopup(new maplibregl.Popup().setText(o.name))
          .addTo(map);
      }
      new maplibregl.Marker({ color })
        .setLngLat([candidate.lon, candidate.lat])
        .setPopup(new maplibregl.Popup().setText(candidate.label))
        .addTo(map);

      // Fit to everything the user should see: candidate, own outlets, AND the nearby
      // competitors — so the competitive landscape is visible without panning.
      // Guard against a mis-geocoded outlier (e.g. a branch accidentally pinned near
      // Baguio) dragging the initial view out to the whole island: only EXTEND the fit
      // bounds with points near the candidate (~40 km box, which covers all of NCR).
      // Outlier markers are still plotted — they just don't hijack the opening frame.
      // This map answers "what competes with THIS site?", so it opens on the site's own
      // trade area — not on the brand's entire outlet network. A national chain passes in
      // every open branch (Jollibee has dozens across NCR); fitting all of them zoomed the
      // view out to the whole region and collapsed the competitor dots into a speck.
      // Distant branches are still plotted — they just don't hijack the opening frame.
      const mPerDegLat = 111_320;
      const mPerDegLon = 111_320 * Math.cos((candidate.lat * Math.PI) / 180);
      const distM = (lat: number, lon: number) =>
        Math.hypot((lat - candidate.lat) * mPerDegLat, (lon - candidate.lon) * mPerDegLon);
      // Neighbourhood window: a few catchments wide, floored so a tiny kiosk catchment
      // still opens on a readable block rather than a rooftop.
      const NEAR_M = Math.max(candidate.catchmentM * 3, 3000);

      const b = new maplibregl.LngLatBounds();
      // Always show at least the candidate's full catchment ring.
      const dLat = candidate.catchmentM / mPerDegLat;
      const dLon = candidate.catchmentM / mPerDegLon;
      b.extend([candidate.lon - dLon, candidate.lat - dLat]);
      b.extend([candidate.lon + dLon, candidate.lat + dLat]);

      outlets.forEach((o) => { if (distM(o.lat, o.lon) <= NEAR_M) b.extend([o.lon, o.lat]); });
      // Frame on what actually competes — unrelated context dots shouldn't widen the view.
      const framing = competitors.filter((c) => (c.tier ?? 'direct') !== 'unrelated');
      (framing.length ? framing : competitors).forEach((c) => {
        if (distM(c.lat, c.lon) <= NEAR_M) b.extend([c.lon, c.lat]);
      });
      map.fitBounds(b, { padding: 60, maxZoom: 16 });

      // Ensure the GL canvas matches the (possibly late-computed) container size, so the
      // basemap tiles fill the box instead of rendering into a 0-size / black canvas.
      map.resize();
      // A second resize after fitBounds settles guards against a late layout shift.
      setTimeout(() => map.resize(), 250);
    });
    } // end buildMap

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.id]);

  // Legend counts — only show a tier that is actually on the map.
  const counts = competitors.reduce(
    (acc, c) => { acc[c.tier ?? 'direct']++; return acc; },
    { direct: 0, adjacent: 0, unrelated: 0 } as Record<'direct' | 'adjacent' | 'unrelated', number>,
  );
  const legend: Array<{ tier: 'direct' | 'adjacent' | 'unrelated'; text: string }> = [
    { tier: 'direct', text: `Direct competitor (${counts.direct})` },
    { tier: 'adjacent', text: `Adjacent format (${counts.adjacent})` },
    { tier: 'unrelated', text: `Other business (${counts.unrelated})` },
  ];

  return (
    // Outer box is the positioning context + fixed size. The map div is a sized child
    // (MapLibre appends its own canvas into it).
    <div className="relative h-[420px] w-full overflow-hidden rounded-xl border border-ink-border">
      <div ref={ref} className="absolute inset-0 h-full w-full" />
      {competitors.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-lg border border-ink-border bg-ink-panel/90 px-3 py-2 backdrop-blur-sm">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Nearby establishments</p>
          <ul className="space-y-1">
            {legend.filter((l) => counts[l.tier] > 0).map((l) => {
              const s = TIER_STYLE[l.tier];
              return (
                <li key={l.tier} className="flex items-center gap-2 text-[11px] text-ink-text">
                  <span
                    className="inline-block shrink-0 rounded-full"
                    style={{ width: s.size, height: s.size, background: s.fill, border: `1.5px solid ${s.border}`, opacity: s.opacity }}
                  />
                  {l.text}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
