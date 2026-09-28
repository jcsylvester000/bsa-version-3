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

/** Default free basemap (CARTO) matching the active theme. NEXT_PUBLIC_MAP_TILE_URL still overrides it. */
export function defaultBasemapUrl(): string {
  return `https://a.basemaps.cartocdn.com/${isLightThemeActive() ? 'light_all' : 'dark_all'}/{z}/{x}/{y}.png`;
}
