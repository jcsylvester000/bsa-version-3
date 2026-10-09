/**
 * Offline address fallback (2026-10-09 audit) — used when Google geocoding is off (database-only mode)
 * or finds nothing. No network, no cost, nothing invented:
 *   - typed coordinates ("16.41, 120.59") are returned exactly;
 *   - a city / municipality / province name is matched against the bundled PSGC index and the map is
 *     centred on its bounding box — flagged `approximate` so the UI asks the user to drop the pin on
 *     the actual site. Approximate results must never be used as a site's coordinates.
 */
import index from '@/lib/geo/psgcIndex.json';

export interface LocalGeocodeResult {
  lat: number;
  lon: number;
  formattedAddress: string;
  types: string[];
  /** true = only a city/province centre; the user still has to pin the exact site. */
  approximate: boolean;
}

type Muni = [number, string | null, number | null, number, number, number, number, number];
type Prov = [number, string | null, number, number, number, number, number];
const MUNICITIES = (index as unknown as { municities: Muni[] }).municities;
const PROVINCES = (index as unknown as { provinces: Prov[] }).provinces;
const PROVINCE_NAME = new Map(PROVINCES.map((p) => [p[0], p[1] ?? '']));

const PH = { s: 4.2, n: 21.5, w: 116, e: 127 };
const r6 = (v: number) => Math.round(v * 1e6) / 1e6;

export function normalizePlace(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** "City of Makati" → ["city of makati", "makati city", "makati"]; "Baguio City" → ["baguio city", "baguio"]. */
function aliases(name: string): string[] {
  const n = normalizePlace(name);
  const out = new Set([n]);
  const m = /^city of (.+)$/.exec(n);
  if (m) { out.add(`${m[1]} city`); out.add(m[1]); }
  const c = /^(.+) city$/.exec(n);
  if (c) out.add(c[1]);
  return [...out].filter((a) => a.length >= 3);
}

const has = (hay: string, needle: string) => ` ${hay} `.includes(` ${needle} `);

/** Typed "lat, lon" inside the Philippines, or null. Pure (unit-tested). */
export function parseLatLon(q: string): { lat: number; lon: number } | null {
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{2,3}(?:\.\d+)?)\s*$/.exec(q);
  if (!m) return null;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (!(lat >= PH.s && lat <= PH.n && lon >= PH.w && lon <= PH.e)) return null;
  return { lat: r6(lat), lon: r6(lon) };
}

/** Pure (unit-tested). */
export function localGeocode(query: string): LocalGeocodeResult | null {
  const exact = parseLatLon(query);
  if (exact) return { ...exact, formattedAddress: `${exact.lat}, ${exact.lon}`, types: ['coordinates'], approximate: false };

  const q = normalizePlace(query);
  if (q.length < 3) return null;

  let best: { m: Muni; score: number } | null = null;
  for (const m of MUNICITIES) {
    if (!m[1]) continue;
    for (const a of aliases(m[1])) {
      if (!has(q, a)) continue;
      const prov = m[2] != null ? normalizePlace(PROVINCE_NAME.get(m[2]) ?? '') : '';
      // Longer, more specific names win; a city beats a same-named municipality ("Quezon City" vs
      // "Quezon"); naming the province too ("San Jose, Batangas") settles duplicates.
      const score = a.length * 2 + (a === normalizePlace(m[1]) ? 3 : 0) + (/city/.test(normalizePlace(m[1])) ? 2 : 0) + (prov && has(` ${q} `.replace(` ${a} `, ' ').trim(), prov) ? 20 : 0);
      if (!best || score > best.score) best = { m, score };
    }
  }
  if (best) {
    const [, name, provPsgc, , s, w, n, e] = best.m;
    const prov = provPsgc != null ? PROVINCE_NAME.get(provPsgc) : null;
    return {
      lat: r6((s + n) / 2), lon: r6((w + e) / 2),
      formattedAddress: `${name}${prov && !normalizePlace(name ?? '').includes(normalizePlace(prov)) ? `, ${prov}` : ''} (centre — approximate)`,
      types: ['locality', 'approximate'], approximate: true,
    };
  }
  for (const p of PROVINCES) {
    if (!p[1] || !has(q, normalizePlace(p[1]))) continue;
    const [, name, , s, w, n, e] = p;
    return { lat: r6((s + n) / 2), lon: r6((w + e) / 2), formattedAddress: `${name} province (centre — approximate)`, types: ['province', 'approximate'], approximate: true };
  }
  return null;
}
