/**
 * Regression tests for the 2026-10-09 application audit fixes (docs/qa-history/QA_AUDIT_2026-10-09.md).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { crossSiteBlock } from '@/lib/api/respond';
import { localGeocode, parseLatLon } from '@/lib/geo/localGeocode';
import { zonalRentCrossCheck } from '@/lib/modules/leaseMath';
import { PRICE_VERDICT_PATTERNS } from '@/lib/truth/guardrailCopy';

const req = (headers: Record<string, string>) => new Request('https://bsa.test/api/x', { method: 'POST', headers: { host: 'bsa.test', ...headers } });

describe('L2 — crossSiteBlock (bodyless POST CSRF guard)', () => {
  it('allows same-origin and direct navigation', () => {
    expect(crossSiteBlock(req({ 'sec-fetch-site': 'same-origin' }))).toBeNull();
    expect(crossSiteBlock(req({ 'sec-fetch-site': 'none' }))).toBeNull();
  });
  it('blocks cross-site and same-site (another subdomain)', () => {
    expect(crossSiteBlock(req({ 'sec-fetch-site': 'cross-site' }))?.status).toBe(403);
    expect(crossSiteBlock(req({ 'sec-fetch-site': 'same-site' }))?.status).toBe(403);
  });
  it('falls back to Origin vs Host when Sec-Fetch-Site is absent', () => {
    expect(crossSiteBlock(req({ origin: 'https://bsa.test' }))).toBeNull();
    expect(crossSiteBlock(req({ origin: 'https://evil.example' }))?.status).toBe(403);
    expect(crossSiteBlock(req({ origin: 'not a url' }))?.status).toBe(403);
  });
  it('lets non-browser callers without either header through (auth still applies)', () => {
    expect(crossSiteBlock(req({}))).toBeNull();
  });
});

describe('Offline geocode fallback', () => {
  it('parses typed coordinates inside the Philippines only', () => {
    expect(parseLatLon('16.4023, 120.596')).toEqual({ lat: 16.4023, lon: 120.596 });
    expect(parseLatLon('14.55 121.02')).toEqual({ lat: 14.55, lon: 121.02 });
    expect(parseLatLon('51.5, -0.12')).toBeNull();
    expect(parseLatLon('Session Road')).toBeNull();
  });
  it('returns typed coordinates as exact (not approximate)', () => {
    const r = localGeocode('10.3157, 123.8854');
    expect(r).toMatchObject({ lat: 10.3157, lon: 123.8854, approximate: false });
  });
  it('centres on a named city and flags it approximate', () => {
    const r = localGeocode('Session Road, Baguio City');
    expect(r?.approximate).toBe(true);
    expect(r?.formattedAddress).toMatch(/Baguio City/);
    expect(r!.lat).toBeGreaterThan(16.3); expect(r!.lat).toBeLessThan(16.5);
  });
  it('prefers the city over a same-named municipality', () => {
    const r = localGeocode('Commonwealth Ave, Quezon City');
    expect(r?.formattedAddress).toMatch(/^Quezon City/);
    expect(r!.lat).toBeGreaterThan(14.5); expect(r!.lat).toBeLessThan(14.8);
  });
  it('matches "Makati" to the City of Makati', () => {
    expect(localGeocode('Ayala Ave Makati')?.formattedAddress).toMatch(/Makati/);
  });
  it('returns null for nothing recognisable', () => {
    expect(localGeocode('zzzz qqqq')).toBeNull();
    expect(localGeocode('ab')).toBeNull();
  });
});

describe('M2 — zonal rent cross-check wording is neutral', () => {
  const band = { low: 6, high: 14 } as Parameters<typeof zonalRentCrossCheck>[2];
  it.each([[2000, 'rich'], [100, 'thin'], [800, 'inline']] as const)('rent %s → %s with no price verdict', (rent, pos) => {
    const r = zonalRentCrossCheck(rent, 100_000, band);
    expect(r.position).toBe(pos);
    expect(r.note).not.toMatch(/\brich\b|\bcheap\b|expensive/i);
    for (const p of PRICE_VERDICT_PATTERNS) expect(r.note).not.toMatch(p);
  });
  it('names zonal value as a tax-reference floor when off-band', () => {
    expect(zonalRentCrossCheck(2000, 100_000, band).note).toMatch(/tax-reference floor/);
  });
});

import { zonalBandComparable, zonalScheduleYear, ZONAL_MAX_SPREAD } from '@/lib/modules/leaseMath';
import { leaseTradeoffNote, locationRead } from '@/lib/modules/leaseTradeoff';
import { provisionalNoteFor } from '@/lib/modules/siteReportModel';

describe('Data check — zonal bands', () => {
  it('a city-wide Taguig CR band (₱9,000–₱2,160,000) is not comparable', () => {
    expect(zonalBandComparable(9_000, 2_160_000)).toEqual({ spread: 240, comparable: false });
  });
  it('a typical barangay band is comparable', () => {
    expect(zonalBandComparable(400_000, 940_000).comparable).toBe(true);
    expect(zonalBandComparable(10_000, 10_000 * ZONAL_MAX_SPREAD).comparable).toBe(true);
  });
  it('reads the schedule year from both note styles', () => {
    expect(zonalScheduleYear('Source: Official 2025 BIR Schedule of Zonal Values — Taguig City')).toBe(2025);
    expect(zonalScheduleYear('BIR schedule updated: 2021')).toBe(2021);
    expect(zonalScheduleYear('BIR schedule updated: Latest schedule on record (year not confirmed)')).toBeNull();
  });
});

describe('Lease — rent vs location read', () => {
  it('reads location from territory + daypart; a territory no-go is weak', () => {
    expect(locationRead('go', 70)).toBe('strong');
    expect(locationRead('caution', 50)).toBe('mixed');
    expect(locationRead('nogo', 90)).toBe('weak');
    expect(locationRead(null, null)).toBeNull();
  });
  it('higher rent + strong location leaves the budget call to the broker, with no price verdict', () => {
    const n = leaseTradeoffNote(80, 'strong')!;
    expect(n).toMatch(/above the corridor median/);
    expect(n).toMatch(/broker and client decide/);
    for (const p of PRICE_VERDICT_PATTERNS) expect(n).not.toMatch(p);
    expect(n).not.toMatch(/cheap|expensive/i);
  });
  it('no asking rent → no note', () => {
    expect(leaseTradeoffNote(null, 'strong')).toBeNull();
  });
});

describe('F1 — provisional marker', () => {
  it('marks gathering runs provisional and limited runs as such; normal runs get nothing', () => {
    expect(provisionalNoteFor('waiting')).toMatch(/^Provisional/);
    expect(provisionalNoteFor('running')).toMatch(/^Provisional/);
    expect(provisionalNoteFor('unavailable')).toMatch(/limited/);
    expect(provisionalNoteFor('done')).toBeNull();
    expect(provisionalNoteFor(null)).toBeNull();
  });
});
