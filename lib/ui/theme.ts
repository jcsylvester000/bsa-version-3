/**
 * Theme preference (design v2, Settings → Appearance). Stored in a plain, non-sensitive cookie so the
 * root layout can render <html data-theme> on the server — no flash of the wrong theme and no inline
 * script (the CSP forbids un-nonced scripts). Client-safe: no server-only imports.
 */
export const THEME_COOKIE = 'bsa-theme';
export const THEMES = ['dark', 'light', 'system'] as const;
export type Theme = (typeof THEMES)[number];
export const DEFAULT_THEME: Theme = 'dark';

/** Parse an untrusted cookie value — anything unknown falls back to the default. */
export function parseTheme(v: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as Theme) : DEFAULT_THEME;
}

/** Browser only: is the page currently rendering the light theme (explicit, or "system" on a light device)? */
export function isLightThemeActive(): boolean {
  if (typeof document === 'undefined') return false;
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'light') return true;
  if (t === 'system') return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches === true;
  return false;
}

/**
 * Default basemap: OpenStreetMap's standard tiles (2026-10-07 — CARTO's free basemaps started returning
 * "API KEY REQUIRED" tiles). MapLibre stays the map engine; only the tile source changed.
 * NEXT_PUBLIC_MAP_TILE_URL still overrides it — production should point that at a tile provider or a
 * self-hosted tile server, because the public OSM tile server is a donated service for light use only
 * (https://operations.osmfoundation.org/policies/tiles/).
 */
export const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';
/** OSM's standard tiles stop at zoom 19. */
export const OSM_MAX_ZOOM = 19;

export function defaultBasemapUrl(): string {
  return OSM_TILE_URL;
}

/**
 * Raster paint for the basemap layer. OSM tiles exist only in a light style, so in the dark theme the
 * default tiles are inverted in the GPU (brightness flip + 180° hue rotation keeps water blue and parks
 * green) and desaturated / softened so BSA's own markers stay readable on top. Any other tile source is left untouched.
 */
export function basemapPaint(tileUrl: string): Record<string, number> {
  if (tileUrl !== OSM_TILE_URL || isLightThemeActive()) return {};
  return {
    'raster-brightness-min': 0.9,
    'raster-brightness-max': 0.1,
    'raster-hue-rotate': 180,
    'raster-saturation': -0.55,
    'raster-contrast': -0.15,
  };
}
