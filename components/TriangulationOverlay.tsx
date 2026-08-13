'use client';

import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';

export interface GeoPoint { lat: number; lon: number }

/**
 * TriangulationOverlay — a cinematic "spy-movie" triangulation + water-ripple animation
 * drawn on a canvas pinned to a MapLibre map. When Territory Guard results land, it:
 *   1. drops a targeting reticle on the candidate site,
 *   2. fires scan lines one-by-one from the candidate to every outlet + competitor
 *      (traveling-dash "lock-on"), and links the outer points into a faint web,
 *   3. emits concentric water ripples from the candidate (the proposed area), sized to
 *      the catchment radius, expanding + fading like water,
 *   4. settles into a subtle persistent web with a slow gentle ripple loop.
 *
 * The canvas re-projects geo→screen each frame via map.project(), so the whole effect
 * stays glued to the real map points as the user pans/zooms. Pure Canvas 2D +
 * requestAnimationFrame — no dependencies. Honors prefers-reduced-motion (renders the
 * settled web + rings once, no motion). It's non-interactive (pointer-events: none) so
 * map markers/popups keep working underneath.
 */
export function TriangulationOverlay({
  map,
  candidate,
  points,
  catchmentM,
  color = '#e0a568',
  play,
}: {
  map: maplibregl.Map | null;
  candidate: GeoPoint;
  points: GeoPoint[];
  catchmentM: number;
  color?: string;
  /** Bump this value (e.g. a timestamp) to (re)play the cinematic sequence. */
  play: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const map0 = map;
    const canvas = canvasRef.current;
    if (!map0 || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // rgba helper from the accent hex.
    const rgb = hexToRgb(color);
    const rgba = (a: number) => `rgba(${rgb.r},${rgb.g},${rgb.b},${a})`;

    // Sizing: match the canvas backing store to the map container + DPR for crisp lines.
    function resize() {
      const { width, height } = map0!.getCanvas().getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    // Project a geo point to screen px (CSS px, since ctx is DPR-scaled).
    const project = (p: GeoPoint) => {
      const pt = map0!.project([p.lon, p.lat]);
      return { x: pt.x, y: pt.y };
    };

    // Approx catchment radius in screen px: project the centre and a point one catchment
    // north, take the pixel distance. Recomputed each frame so it tracks zoom.
    function catchmentRadiusPx(): number {
      const c = project(candidate);
      const north: GeoPoint = { lat: candidate.lat + catchmentM / 111_320, lon: candidate.lon };
      const n = project(north);
      return Math.max(24, Math.hypot(n.x - c.x, n.y - c.y));
    }

    // ---- timeline (ms) ----
    const T_RETICLE = 400;        // reticle draw-in
    const T_LINES = 1300;         // scan lines fire out (staggered)
    const T_RIPPLE_START = 700;   // ripples begin during line phase
    const CINEMATIC = 2600;       // full sequence length
    const RIPPLE_PERIOD = 2200;   // one ripple every 2.2s in idle
    const RIPPLE_LIFE = 1800;     // each ripple lives 1.8s

    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

    function draw(now: number) {
      if (!startRef.current) startRef.current = now;
      const elapsed = reduced ? CINEMATIC : now - startRef.current; // reduced: jump to settled
      const w = canvas!.width, h = canvas!.height;
      ctx!.clearRect(0, 0, w, h);

      const c = project(candidate);
      const targets = points.map(project);
      const rPx = catchmentRadiusPx();

      // Global fade: the cinematic phase is bright; after CINEMATIC it eases DOWN to a
      // much fainter idle glow (floor 0.12) so the settled web is a subtle presence, not
      // a distracting bundle of bright lines. Takes ~1.4s to reach the floor.
      const settle = elapsed <= CINEMATIC ? 1 : Math.max(0.12, 1 - (elapsed - CINEMATIC) / 1400 * 0.88);

      // --- WATER RIPPLES from the candidate (proposed area) ---
      // During cinematic: a burst of 3 staggered ripples. In idle: one gentle ripple per
      // period. We collect the START time of each ripple that could still be alive now,
      // then draw each by its age below. (Two consecutive idle cycles are considered so a
      // ripple whose life spills past the period boundary still finishes fading.)
      const rippleStarts: number[] = [];
      if (elapsed >= T_RIPPLE_START) {
        if (elapsed <= CINEMATIC) {
          [0, 500, 1000].forEach((off) => { if (elapsed - T_RIPPLE_START >= off) rippleStarts.push(T_RIPPLE_START + off); });
        } else {
          const since = elapsed - T_RIPPLE_START;
          const k = Math.floor(since / RIPPLE_PERIOD);
          rippleStarts.push(T_RIPPLE_START + k * RIPPLE_PERIOD);       // current cycle
          if (k > 0) rippleStarts.push(T_RIPPLE_START + (k - 1) * RIPPLE_PERIOD); // previous (still fading)
        }
      }
      for (const rs of rippleStarts) {
        const age = elapsed - rs;
        if (age < 0 || age > RIPPLE_LIFE) continue;
        const p = age / RIPPLE_LIFE;              // 0..1
        const radius = rPx * (0.15 + easeOut(p) * 1.05);
        const alpha = (1 - p) * 0.5 * settle;
        // water look: a soft outer ring + a fainter inner ring trailing it
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, radius, 0, Math.PI * 2);
        ctx!.strokeStyle = rgba(alpha);
        ctx!.lineWidth = 2;
        ctx!.stroke();
        ctx!.beginPath();
        ctx!.arc(c.x, c.y, radius * 0.82, 0, Math.PI * 2);
        ctx!.strokeStyle = rgba(alpha * 0.5);
        ctx!.lineWidth = 1;
        ctx!.stroke();
      }

      // --- TRIANGULATION WEB between the outer points (faint) ---
      // Fades in during the line phase, persists subtly afterwards.
      const webAlpha = clamp((elapsed - T_LINES * 0.5) / 500, 0, 1) * 0.16 * settle;
      if (webAlpha > 0.01 && targets.length > 1) {
        ctx!.strokeStyle = rgba(webAlpha);
        ctx!.lineWidth = 0.8;
        for (let i = 0; i < targets.length; i++) {
          for (let j = i + 1; j < targets.length; j++) {
            ctx!.beginPath();
            ctx!.moveTo(targets[i].x, targets[i].y);
            ctx!.lineTo(targets[j].x, targets[j].y);
            ctx!.stroke();
          }
        }
      }

      // --- SCAN LINES from candidate → each target (staggered lock-on) ---
      targets.forEach((t, i) => {
        const stagger = targets.length > 0 ? (i / Math.max(1, targets.length)) * (T_LINES * 0.6) : 0;
        const lp = clamp((elapsed - stagger) / (T_LINES * 0.4), 0, 1); // this line's progress
        if (lp <= 0) return;
        const grow = easeOut(lp);
        const ex = c.x + (t.x - c.x) * grow;
        const ey = c.y + (t.y - c.y) * grow;

        // main scan line — bright while drawing, then thin/faint once locked so the idle
        // state is a quiet web rather than a bright bundle.
        ctx!.beginPath();
        ctx!.moveTo(c.x, c.y);
        ctx!.lineTo(ex, ey);
        ctx!.strokeStyle = rgba((lp < 1 ? 0.9 : 0.22) * settle);
        ctx!.lineWidth = lp < 1 ? 1.6 : 0.8;
        ctx!.stroke();

        // traveling "pulse" dot riding the line while it draws
        if (lp < 1) {
          ctx!.beginPath();
          ctx!.arc(ex, ey, 2.6, 0, Math.PI * 2);
          ctx!.fillStyle = rgba(0.95 * settle);
          ctx!.fill();
        } else {
          // lock-on marker: small crosshair square at the target
          const s = 5;
          ctx!.strokeStyle = rgba(0.6 * settle);
          ctx!.lineWidth = 1;
          ctx!.strokeRect(t.x - s, t.y - s, s * 2, s * 2);
        }
      });

      // --- CANDIDATE RETICLE (targeting the proposed site) ---
      const rp = clamp(elapsed / T_RETICLE, 0, 1);
      const reticle = easeOut(rp);
      const rr = 14 * reticle;
      ctx!.strokeStyle = rgba(0.9 * settle);
      ctx!.lineWidth = 1.6;
      // rotating outer ring gap (spins slowly)
      const spin = (elapsed / 1000) % (Math.PI * 2);
      ctx!.beginPath();
      ctx!.arc(c.x, c.y, rr, spin, spin + Math.PI * 1.6);
      ctx!.stroke();
      // crosshair ticks
      ctx!.beginPath();
      ctx!.moveTo(c.x - rr - 4, c.y); ctx!.lineTo(c.x - rr + 3, c.y);
      ctx!.moveTo(c.x + rr - 3, c.y); ctx!.lineTo(c.x + rr + 4, c.y);
      ctx!.moveTo(c.x, c.y - rr - 4); ctx!.lineTo(c.x, c.y - rr + 3);
      ctx!.moveTo(c.x, c.y + rr - 3); ctx!.lineTo(c.x, c.y + rr + 4);
      ctx!.stroke();
      // centre dot
      ctx!.beginPath();
      ctx!.arc(c.x, c.y, 2.4, 0, Math.PI * 2);
      ctx!.fillStyle = rgba(1 * settle);
      ctx!.fill();

      if (reduced) return; // one static frame for reduced-motion users
      rafRef.current = requestAnimationFrame(draw);
    }

    // Redraw immediately on any map movement so projection stays exact.
    const onMove = () => { if (reduced) { startRef.current = 0; requestAnimationFrame(draw); } };
    map0.on('move', onMove);
    map0.on('resize', resize);

    startRef.current = 0;
    rafRef.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafRef.current);
      map0.off('move', onMove);
      map0.off('resize', resize);
    };
    // Re-run (and restart the timeline) when play changes or the map/points change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, play, candidate.lat, candidate.lon, catchmentM, points.length, color]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-10"
      aria-hidden
    />
  );
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
