'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export interface GapPoint {
  rank: number;
  label: string;
  lat: number;
  lon: number;
  score: number;
  reason?: string;
}

/**
 * A single nearby business to plot as a coloured dot: 'direct' = an exact same-concept rival
 * (red), 'adjacent' = a similar / adjacent-format business (white). Lets the map show the SAME
 * businesses the per-area cards list, so the visual and the data line up.
 */
export interface BusinessPoint {
  name: string;
  lat: number;
  lon: number;
  tier: 'direct' | 'adjacent';
}

/**
 * GapsMap — a single OpenStreetMap (free CARTO dark basemap) that pins every ranked
 * White-Space area with its rank number, and (optionally) plots the actual nearby businesses
 * as coloured dots: red for exact/direct rivals, white for similar/adjacent formats. Read-only,
 * no API key (same free basemap the Territory map uses).
 */
export function GapsMap({ gaps, businesses = [] }: { gaps: GapPoint[]; businesses?: BusinessPoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!ref.current || mapRef.current) return;
    const plot = gaps.filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon));
    if (plot.length === 0) return;
    const bizPlot = businesses.filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lon));

    // Center on the mean of the gap points; fitBounds tightens it after load.
    const cLat = plot.reduce((s, g) => s + g.lat, 0) / plot.length;
    const cLon = plot.reduce((s, g) => s + g.lon, 0) / plot.length;

    const tiles = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';
    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: [tiles], tileSize: 256, attribution: '© OpenStreetMap contributors © CARTO' } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [cLon, cLat],
      zoom: 11,
    });
    mapRef.current = map;

    map.on('load', () => {
      const bounds = new maplibregl.LngLatBounds();

      // Business dots FIRST, so the numbered area pins draw on top of them.
      // Red = exact/direct same-concept rival · White = similar/adjacent-format business.
      for (const b of bizPlot) {
        const isDirect = b.tier === 'direct';
        const dot = document.createElement('div');
        dot.title = `${b.name} — ${isDirect ? 'exact / same concept' : 'similar / adjacent'}`;
        dot.style.cssText =
          `width:${isDirect ? 10 : 9}px;height:${isDirect ? 10 : 9}px;border-radius:50%;` +
          (isDirect
            ? 'background:#e5484d;border:1.5px solid #0b1426;'          // red = direct/exact
            : 'background:#e6ebf5;border:1.5px solid #0b1426;') +       // white = adjacent/similar
          'box-shadow:0 1px 2px rgba(0,0,0,.5);cursor:pointer';
        new maplibregl.Marker({ element: dot }).setLngLat([b.lon, b.lat]).addTo(map);
        bounds.extend([b.lon, b.lat]);
      }

      for (const g of plot) {
        // Numbered amber pin: a small round badge with the rank.
        const el = document.createElement('div');
        el.style.cssText =
          'width:24px;height:24px;border-radius:50%;background:#BE8562;color:#0b1426;' +
          'display:grid;place-items:center;font-size:12px;font-weight:800;' +
          'border:2px solid #0b1426;box-shadow:0 1px 4px rgba(0,0,0,.5);cursor:pointer';
        el.textContent = String(g.rank);
        const popupHtml =
          `<div style="min-width:150px">` +
          `<div style="font-weight:700">#${g.rank} ${escapeHtml(g.label)}</div>` +
          `<div style="color:#94A3BE;font-size:11px;margin-top:2px">Opportunity ${Math.round(g.score)}/100</div>` +
          (g.reason ? `<div style="color:#94A3BE;font-size:11px;margin-top:2px">${escapeHtml(g.reason)}</div>` : '') +
          `</div>`;
        new maplibregl.Marker({ element: el })
          .setLngLat([g.lon, g.lat])
          .setPopup(new maplibregl.Popup({ offset: 14 }).setHTML(popupHtml))
          .addTo(map);
        bounds.extend([g.lon, g.lat]);
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 56, maxZoom: 14 });
      map.resize();
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Re-init only when the set of gap OR business coordinates changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gaps.map((g) => `${g.lat},${g.lon}`).join('|'), businesses.map((b) => `${b.lat},${b.lon},${b.tier}`).join('|')]);

  const plottable = gaps.filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon)).length;
  if (plottable === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink-border p-4 text-center text-xs text-ink-muted">
        Map view isn&apos;t available for these gaps yet — re-run the analysis to attach barangay
        coordinates, then the locations will plot here.
      </div>
    );
  }

  return <div ref={ref} className="h-[360px] w-full overflow-hidden rounded-lg border border-ink-border" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
