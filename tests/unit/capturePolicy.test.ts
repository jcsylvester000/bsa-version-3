/** The capture playbook as code: ring limits, business-type cap, off-peak window, freshness. */
import { describe, it, expect } from 'vitest';
import { checkAreaPolicy, denseZoneAt, freshness, manilaHour, osmWindow, ringPolicy, FRESH_DAYS, RING_DENSE_MAX_M, RING_TOWN_MAX_M } from '@/lib/capture/capturePolicy';
import { MAX_CAPTURE_VERTICALS, layersForSite } from '@/lib/capture/territoryAlign';

describe('capture policy', () => {
  it('dense centres cap the ring at 1,000 m; towns at 1,500 m', () => {
    expect(denseZoneAt(14.5547, 121.0244)).toBe('Makati CBD');
    expect(denseZoneAt(14.4334, 120.8864)).toBeNull(); // Noveleta
    expect(ringPolicy(14.5547, 121.0244).maxM).toBe(RING_DENSE_MAX_M);
    expect(ringPolicy(14.4334, 120.8864).maxM).toBe(RING_TOWN_MAX_M);
    expect(ringPolicy(14.4334, 120.8864, 450).dense).toBe(true); // many stored places → dense
    expect(checkAreaPolicy({ kind: 'circle', lat: 14.5547, lon: 121.0244, radiusM: 1500 }).ok).toBe(false);
    expect(checkAreaPolicy({ kind: 'circle', lat: 14.5547, lon: 121.0244, radiusM: 900 }).ok).toBe(true);
    expect(checkAreaPolicy({ kind: 'circle', lat: 14.4334, lon: 120.8864, radiusM: 1500 }).ok).toBe(true);
    expect(checkAreaPolicy({ kind: 'circle', lat: 14.4334, lon: 120.8864, radiusM: 2000 }).ok).toBe(false);
    expect(checkAreaPolicy({ kind: 'rect', south: 14.40, west: 120.86, north: 14.46, east: 120.92 }).ok).toBe(false); // ~43 km²
  });

  it('at most 3 business types per capture (screen and API)', () => {
    expect(MAX_CAPTURE_VERTICALS).toBe(3);
    const layers = layersForSite(['fnb_qsr', 'fnb_cafe', 'fnb_bakery', 'pharmacy'], []);
    expect(layers.filter((l) => l.startsWith('v:')).length).toBe(3);
  });

  it('off-peak is 5 AM–noon Philippine time', () => {
    expect(manilaHour(new Date('2026-10-07T22:00:00Z'))).toBe(6);
    expect(osmWindow(new Date('2026-10-07T22:00:00Z')).offPeak).toBe(true);   // 6 AM PHT
    expect(osmWindow(new Date('2026-10-08T03:59:00Z')).offPeak).toBe(true);   // 11:59 AM PHT
    expect(osmWindow(new Date('2026-10-08T04:00:00Z')).offPeak).toBe(false);  // noon PHT
    expect(osmWindow(new Date('2026-10-08T12:00:00Z')).offPeak).toBe(false);  // 8 PM PHT
  });

  it('coverage is fresh for 90 days, then due', () => {
    const now = Date.parse('2026-10-08T00:00:00Z');
    expect(freshness('2026-08-01T00:00:00Z', now).fresh).toBe(true);
    expect(freshness('2026-06-01T00:00:00Z', now).fresh).toBe(false);
    expect(FRESH_DAYS).toBe(90);
  });
});
