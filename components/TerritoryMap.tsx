'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { geoCircle, VERDICT_COLOR } from '@/lib/geo/mapGeometry';
import { markerElement, MapLegend, SrMarkerList, type MarkerKind } from '@/components/MapMarkers';

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
const TIER_STYLE: Record<'direct' | 'adjacent' | 'unrelated', { kind: MarkerKind; rank: number; label: string }> = {
  direct: { kind: 'direct', rank: 3, label: 'Direct competitor' },
  adjacent: { kind: 'adjacent', rank: 2, label: 'Adjacent — sells similar, different format' },
  unrelated: { kind: 'other', rank: 1, label: 'Nearby business — not a competitor' },
};

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
        paint: { 'line-color': '#1C335E', 'line-width': 1.5, 'line-dasharray': [2, 2] },
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
        (a, b) => TIER_STYLE[a.tier ?? 'direct'].rank - TIER_STYLE[b.tier ?? 'direct'].rank,
      );
      for (const c of ordered) {
        const tier = c.tier ?? 'direct';
        const s = TIER_STYLE[tier];
        const el = markerElement(s.kind, `${c.name} — ${s.label}`);
        const suffix = c.category && c.category !== 'other' ? ` · ${c.category.replace(/_/g, ' ')}` : '';
        new maplibregl.Marker({ element: el })
          .setLngLat([c.lon, c.lat])
          .setPopup(new maplibregl.Popup({ offset: 8 }).setText(`${c.name} — ${s.label}${suffix}`))
          .addTo(map);
      }

      // Own outlets (ring) + candidate (Muesli pin, anchored at its tip). The catchment ring
      // keeps the verdict colour.
      for (const o of outlets) {
        new maplibregl.Marker({ element: markerElement('outlet', `Your outlet: ${o.name}`) })
          .setLngLat([o.lon, o.lat])
          .setPopup(new maplibregl.Popup().setText(o.name))
          .addTo(map);
      }
      new maplibregl.Marker({ element: markerElement('site', candidate.label), anchor: 'bottom' })
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
  const legend: Array<{ kind: MarkerKind; text: string }> = [
    { kind: 'site', text: 'This site' },
    ...(outlets.length ? [{ kind: 'outlet' as const, text: `Your outlets (${outlets.length})` }] : []),
    ...(counts.direct ? [{ kind: 'direct' as const, text: `Direct competitor (${counts.direct})` }] : []),
    ...(counts.adjacent ? [{ kind: 'adjacent' as const, text: `Adjacent format (${counts.adjacent})` }] : []),
    ...(counts.unrelated ? [{ kind: 'other' as const, text: `Other business — context (${counts.unrelated})` }] : []),
  ];
  const srItems = [
    `This site: ${candidate.label}, catchment ${Math.round(candidate.catchmentM)} m`,
    ...outlets.map((o) => `Your outlet: ${o.name}`),
    ...competitors.filter((c) => (c.tier ?? 'direct') !== 'unrelated').map((c) => `${TIER_STYLE[c.tier ?? 'direct'].label}: ${c.name}`),
    ...(counts.unrelated ? [`Plus ${counts.unrelated} other nearby businesses shown for context only`] : []),
  ];

  return (
    // Outer box is the positioning context + fixed size. The map div is a sized child
    // (MapLibre appends its own canvas into it).
    <div className="relative h-[420px] w-full overflow-hidden rounded-xl border border-ink-border">
      <div ref={ref} className="absolute inset-0 h-full w-full" aria-hidden />
      <MapLegend items={legend} />
      <SrMarkerList title="Territory map markers" items={srItems} />
    </div>
  );
}
