/**
 * Brief alignment Batch 3 (2026-11-04) — OpenStreetMap busy vs broken (C-5), 90-day refresh (C-4),
 * partial-coverage notice (C-2), rent freshness (C-7).
 */
import { describe, it, expect, vi } from 'vitest';
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
import { readOverpassStatus, isOverpassBusyError } from '@/lib/places/osmService';
import { onlyBusyFailures, jobAgeDays, layerForCoverageKey, BUSY_GIVE_UP_DAYS } from '@/lib/services/autofill';
import { coverageNoteFor, listRegions } from '@/lib/geo/regions';
import { leaseFreshness, LEASE_AGEING_MONTHS, LEASE_STALE_MONTHS } from '@/lib/modules/leaseMath';
import { compFreshnessLabel, compCountLabel } from '@/lib/modules/siteReportModel';

describe('OpenStreetMap status: busy is not unreachable (C-5)', () => {
  it('reads the real "at capacity" 502 page as busy', () => {
    const page = '# 502 Gateway Timeout  This Overpass API server is currently at capacity. All query workers are busy and the request queue is full.';
    expect(readOverpassStatus(502, page)).toEqual({ reachable: true, busy: true, slotsNow: 0, waitSeconds: 60 });
    expect(readOverpassStatus(504, '<html>504 Gateway Time-out</html>').busy).toBe(true);
    expect(readOverpassStatus(429, '').busy).toBe(true);
  });
  it('reads slots and waits from a normal status page', () => {
    expect(readOverpassStatus(200, 'Rate limit: 2\n2 slots available now.')).toEqual({ reachable: true, busy: false, slotsNow: 2, waitSeconds: 0 });
    expect(readOverpassStatus(200, 'Rate limit: 2\nSlot available after: 2026-11-04T09:00:30Z, in 30 seconds.')).toMatchObject({ busy: true, waitSeconds: 30 });
    expect(readOverpassStatus(200, 'Slot available after: …, in 8 seconds.')).toMatchObject({ busy: false, waitSeconds: 8 });
  });
  it('no answer is unreachable; a 400 is not busy', () => {
    expect(readOverpassStatus(null, '')).toEqual({ reachable: false, busy: false, slotsNow: null, waitSeconds: 0 });
    expect(readOverpassStatus(400, 'bad request')).toMatchObject({ reachable: false, busy: false });
  });
  it('tells "try later" failures from real errors', () => {
    for (const m of ['Overpass timed out on https://overpass-api.de', 'Overpass 502 on x', 'OpenStreetMap did not answer in time — logged', 'OpenStreetMap is busy (servers at capacity)', 'fetch failed', 'OpenStreetMap is rate-limiting this server'])
      expect(isOverpassBusyError(m)).toBe(true);
    for (const m of ['Overpass 400 on x', 'OpenStreetMap returned an error (Unexpected token < in JSON)', 'Unknown layer'])
      expect(isOverpassBusyError(m)).toBe(false);
  });
  it('a job that only met a busy OpenStreetMap waits without using an attempt, for up to 7 days', () => {
    expect(onlyBusyFailures(['transport', 'health'], ['transport', 'health'])).toBe(true);
    expect(onlyBusyFailures(['transport', 'health'], ['transport'])).toBe(false);
    expect(onlyBusyFailures([], [])).toBe(false);
    const now = Date.parse('2026-11-10T00:00:00Z');
    expect(jobAgeDays('2026-11-04T00:00:00Z', now)).toBe(6);
    expect(jobAgeDays('2026-11-02T00:00:00Z', now)).toBeGreaterThanOrEqual(BUSY_GIVE_UP_DAYS);
    expect(jobAgeDays(null, now)).toBe(0);
  });
});

describe('90-day refresh maps stale coverage back to capture layers (C-4)', () => {
  it('handles bulk, capture and concept keys', () => {
    expect(layerForCoverageKey('layer:transport')).toBe('transport');
    expect(layerForCoverageKey('__transport__')).toBe('transport');
    expect(layerForCoverageKey('layer:anchors')).toBe('anchors');
    expect(layerForCoverageKey('fnb_qsr')).toBe('v:fnb_qsr');
    expect(layerForCoverageKey('pharmacy')).toBe('v:pharmacy');
    expect(layerForCoverageKey('not_a_layer_xyz')).toBeNull();
  });
});

describe('Partial-coverage notice (C-2)', () => {
  it('Metro Manila is fully covered; partly loaded regions say so', () => {
    expect(coverageNoteFor('ncr')).toBeNull();
    expect(coverageNoteFor('cavite')).toMatch(/partly loaded/);
    expect(coverageNoteFor('davao')).toMatch(/provisional/);
    expect(coverageNoteFor('laguna')).toMatch(/not loaded yet/);
    expect(coverageNoteFor('ph-car')).toMatch(/outside the regions BSA has mapped/);
    expect(coverageNoteFor(null)).toBeNull();
  });
  it('every registered region declares its coverage', () => {
    for (const r of listRegions()) expect(['live', 'partial', 'planned']).toContain(r.coverage.status);
  });
});

describe('Rent freshness (C-7)', () => {
  const now = new Date('2026-11-04T00:00:00Z');
  it('flags a set over 6 months old as ageing, over 18 as stale', () => {
    expect([LEASE_AGEING_MONTHS, LEASE_STALE_MONTHS]).toEqual([6, 18]);
    const brief = leaseFreshness(['2026-01-10', '2026-05-14'], now); // the 26 Oct snapshot's range
    expect(brief).toMatchObject({ dataAsOf: '2026-05-14', monthsSinceNewest: 6, isAgeing: false, isStale: false, compCount: 2 });
    const older = leaseFreshness(['2026-04-01'], now);
    expect(older).toMatchObject({ isAgeing: true, isStale: false });
    expect(leaseFreshness(['2025-01-01'], now)).toMatchObject({ isAgeing: false, isStale: true });
  });
  it('labels for the Lease summary', () => {
    expect(compFreshnessLabel({ dataAsOf: '2026-04-01', isAgeing: true })).toBe('2026-04-01 · ageing (over 6 months — refresh due)');
    expect(compFreshnessLabel({ dataAsOf: '2025-01-01', isStale: true })).toBe('2025-01-01 · stale (over 18 months old)');
    expect(compFreshnessLabel({ dataAsOf: '2026-10-01', monthsSinceNewest: 1 })).toBe('2026-10-01');
    expect(compFreshnessLabel({ dataAsOf: '2026-03-01', monthsSinceNewest: 8 })).toMatch(/ageing/); // legacy payload, no flag
    expect(compCountLabel(6)).toBe('6 (target 10 per corridor)');
    expect(compCountLabel(12)).toBe('12');
  });
});
