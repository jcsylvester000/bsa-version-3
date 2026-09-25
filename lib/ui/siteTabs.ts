/**
 * Site-page tab keys — a plain (non-'use client') module so SERVER components can use the values.
 *
 * Why this exists: `app/(app)/site/page.tsx` (a Server Component) used to import `TAB_KEYS` from
 * `components/SiteIntelligenceTabs` (a 'use client' module). Next.js gives a server component only a
 * client-reference PROXY for values exported from a client module, so `TAB_KEYS.includes(...)` threw
 * during the server render of EVERY site page ("An error occurred in the Server Components render",
 * React #329/#423). Keep this list in sync with TABS in SiteIntelligenceTabs.tsx (a unit test checks).
 */
export const SITE_TAB_KEYS = ['territory', 'lease', 'daypart', 'whitespace', 'analysis'] as const;
export type SiteTabKey = (typeof SITE_TAB_KEYS)[number];

export function isSiteTabKey(v: unknown): v is SiteTabKey {
  return typeof v === 'string' && (SITE_TAB_KEYS as readonly string[]).includes(v);
}
