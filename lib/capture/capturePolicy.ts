/**
 * Place Capture policy (2026-10-08) — the capture playbook as code, shared by the screen and the server.
 * docs/PLACE_CAPTURE_PLAYBOOK.md is the human version; these constants are the enforced version.
 *
 *   1. Coverage first      → the capture plan marks layers already captured (≤ 90 days) and skips them.
 *   2. Boundaries first    → a pin with no barangay boundary needs an explicit acknowledgement.
 *   3. Ring size           → ≤ 1,000 m in dense centres, ≤ 1,500 m elsewhere (server rejects bigger).
 *   4. 2–3 business types  → at most 3 per capture (server rejects more).
 *   5. One area at a time  → the screen loads one area and asks for Save before the next.
 *   6. Off-peak hours      → 05:00–12:00 Philippine time; outside it the screen warns and slows down.
 *   7. Save what loaded    → Save is always allowed; missed layers go to the retry queue.
 *   8. Re-capture at 90 d  → coverage older than 90 days is "due" and is fetched again.
 *
 * Pure functions only (no DB, no server-only imports) so the browser and the API agree.
 */
import { areaKm2, type CaptureArea } from '@/lib/capture/area';

/** Coverage counts as fresh (and is skipped) for this many days. */
export const FRESH_DAYS = 90;
/** Business types per capture. */
export const MAX_VERTICALS_PER_CAPTURE = 3;
/** Ring limits (metres). Towns: Territory Guard's 1.5 km scan radius. Dense centres: 1 km. */
export const RING_MIN_M = 300;
export const RING_TOWN_MAX_M = 1_500;
export const RING_DENSE_MAX_M = 1_000;
export const RING_DENSE_DEFAULT_M = 800;
/** Stored places per km² above which a ring counts as dense even outside the listed centres. */
export const DENSE_PLACES_PER_KM2 = 300;
/** Off-peak window for the public OpenStreetMap servers, in Philippine time (UTC+8), [start, end). */
export const OFF_PEAK_PHT = { startHour: 5, endHour: 12 } as const;

/** Known dense commercial centres (approximate boxes: south, west, north, east). */
export const DENSE_ZONES: Array<{ name: string; box: [number, number, number, number] }> = [
  { name: 'Makati CBD', box: [14.545, 121.010, 14.567, 121.035] },
  { name: 'Bonifacio Global City', box: [14.540, 121.040, 14.560, 121.060] },
  { name: 'Ortigas Center', box: [14.578, 121.050, 14.595, 121.068] },
  { name: 'Manila (Binondo · Quiapo · Ermita)', box: [14.570, 120.970, 14.610, 121.000] },
  { name: 'Quezon City (Cubao · Triangle Park)', box: [14.610, 121.020, 14.660, 121.060] },
  { name: 'Pasay (MOA · Baclaran)', box: [14.525, 120.975, 14.545, 121.000] },
  { name: 'Alabang', box: [14.410, 121.020, 14.430, 121.050] },
  { name: 'Cebu City (IT Park · Business Park · Colon)', box: [10.290, 123.880, 10.335, 123.915] },
  { name: 'Davao City Poblacion', box: [7.060, 125.600, 7.090, 125.625] },
];

export function denseZoneAt(lat: number, lon: number): string | null {
  const z = DENSE_ZONES.find(({ box: [s, w, n, e] }) => lat >= s && lat <= n && lon >= w && lon <= e);
  return z?.name ?? null;
}

export interface RingPolicy { dense: boolean; reason: string | null; maxM: number; defaultM: number; maxKm2: number }

/** Largest ring allowed at a point: a listed dense centre, or (screen only) a dense stored-place count. */
export function ringPolicy(lat: number, lon: number, storedPlacesPerKm2?: number): RingPolicy {
  const zone = denseZoneAt(lat, lon);
  const byDensity = !zone && storedPlacesPerKm2 != null && storedPlacesPerKm2 >= DENSE_PLACES_PER_KM2;
  const dense = !!zone || byDensity;
  const maxM = dense ? RING_DENSE_MAX_M : RING_TOWN_MAX_M;
  return {
    dense,
    reason: zone ? `${zone} is a dense centre` : byDensity ? `BSA already holds ${Math.round(storedPlacesPerKm2!)} places per km² here` : null,
    maxM,
    defaultM: dense ? RING_DENSE_DEFAULT_M : RING_TOWN_MAX_M,
    maxKm2: Number(((Math.PI * maxM * maxM) / 1e6).toFixed(2)),
  };
}

const centreOf = (a: CaptureArea) => (a.kind === 'circle' ? { lat: a.lat, lon: a.lon } : { lat: (a.south + a.north) / 2, lon: (a.west + a.east) / 2 });

/** Server + screen check of one capture area against the ring rules. */
export function checkAreaPolicy(area: CaptureArea, storedPlacesPerKm2?: number): { ok: true; policy: RingPolicy } | { ok: false; policy: RingPolicy; message: string } {
  const c = centreOf(area);
  const policy = ringPolicy(c.lat, c.lon, storedPlacesPerKm2);
  const where = policy.reason ? ` (${policy.reason})` : '';
  if (area.kind === 'circle') {
    if (area.radiusM > policy.maxM) {
      return { ok: false, policy, message: `Use a ring of ${policy.maxM.toLocaleString('en-US')} m or less here${where}. Bigger rings in busy areas come back incomplete — capture several smaller rings instead.` };
    }
    return { ok: true, policy };
  }
  const km2 = areaKm2(area);
  if (km2 > policy.maxKm2) {
    return { ok: false, policy, message: `This rectangle is ${km2.toFixed(1)} km²; keep it under ${policy.maxKm2} km² here${where}.` };
  }
  return { ok: true, policy };
}

/** Hour of day in the Philippines (UTC+8, no DST). */
export function manilaHour(d: Date = new Date()): number {
  return (d.getUTCHours() + 8) % 24;
}

export interface OsmWindow { offPeak: boolean; hour: number; label: string; advice: string }

export function osmWindow(d: Date = new Date()): OsmWindow {
  const hour = manilaHour(d);
  const offPeak = hour >= OFF_PEAK_PHT.startHour && hour < OFF_PEAK_PHT.endHour;
  const hh = (h: number) => `${((h + 11) % 12) + 1}${h < 12 ? ' AM' : ' PM'}`;
  return {
    offPeak,
    hour,
    label: offPeak ? 'Off-peak — best time to capture' : 'Busy hours on OpenStreetMap',
    advice: offPeak
      ? `Until ${hh(OFF_PEAK_PHT.endHour)} Philippine time the public OpenStreetMap servers are least busy.`
      : `Captures work best ${hh(OFF_PEAK_PHT.startHour)}–${hh(OFF_PEAK_PHT.endHour)} Philippine time. Now: smaller rings and fewer business types; failed layers go to the retry list.`,
  };
}

/** Days since an ISO date; `due` once past the freshness window. */
export function freshness(iso: string | Date, now = Date.now()): { ageDays: number; fresh: boolean; daysLeft: number } {
  const ageDays = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  return { ageDays, fresh: ageDays <= FRESH_DAYS, daysLeft: Math.max(0, FRESH_DAYS - ageDays) };
}
