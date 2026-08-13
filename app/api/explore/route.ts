import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { ok, failValidation, errors } from '@/lib/api/respond';
import { categorizeByName } from '@/lib/places/competitorRelevance';

/**
 * DB-backed Explore endpoint (no Google calls). Reads establishments already in the
 * database and returns them — with a concept category tagged on each — for plotting on
 * the OpenStreetMap basemap. Supports a cannibalization overlay: the caller's own brand
 * outlets are returned separately so the user sees where THEY already are vs competitors.
 *
 *  - mode "nearby": competitor POIs within a radius of a point, optionally filtered to
 *    one category. Each result carries { name, lat, lon, category, categoryLabel }.
 *  - mode "brand":  establishments whose name matches a query (a chain's outlets).
 */
const nearbySchema = z.object({
  mode: z.literal('nearby'),
  lat: z.number(),
  lon: z.number(),
  category: z.string().optional(),      // filter to one concept category (by name)
  radiusM: z.number().min(200).max(8000).default(1500),
  max: z.number().min(1).max(300).default(120),
  myBrand: z.string().optional(),       // cannibalization overlay: my own outlets by name
});
const brandSchema = z.object({
  mode: z.literal('brand'),
  query: z.string().min(2),
  max: z.number().min(1).max(300).default(120),
});
const schema = z.union([nearbySchema, brandSchema]);

type Row = { name: string; lat: number; lon: number; city: string | null };
type Tagged = { name: string; lat: number; lon: number; area: string | null; category: string; categoryLabel: string };

function tag(r: Row): Tagged {
  const c = categorizeByName(r.name);
  return { name: r.name, lat: r.lat, lon: r.lon, area: r.city, category: c.key, categoryLabel: c.label };
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);
  const input = parsed.data;

  if (input.mode === 'nearby') {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT name, lat, lon, city FROM poi
      WHERE category = 'competitor' AND geom IS NOT NULL
        AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography, ${input.radiusM})
      ORDER BY ST_Distance(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography) ASC
      LIMIT 300`;
    let places = rows.map(tag);
    if (input.category && input.category !== 'all') {
      places = places.filter((p) => p.category === input.category);
    }
    places = places.slice(0, input.max);

    // Cannibalization overlay: the caller's own outlets nearby (by name match).
    // Outlet rows are private franchisor data, so this is scoped to the user's OWN
    // franchisor — a franchisor/broker can only ever surface their own branches here,
    // never another tenant's. Staff (no franchisorId) may match across all outlets.
    const isStaff = session.role === 'admin' || session.role === 'analyst';
    const ownFranchisorId = session.franchisorId ?? null;
    let myOutlets: Array<{ name: string; lat: number; lon: number }> = [];
    if (input.myBrand && input.myBrand.trim().length >= 2 && (isStaff || ownFranchisorId)) {
      const q = input.myBrand.trim();
      const own = await prisma.$queryRaw<Row[]>`
        SELECT outlet_name AS name, lat, lon, NULL::text AS city FROM outlet
        WHERE outlet_name ILIKE ${'%' + q + '%'}
          AND (${isStaff}::boolean OR franchisor_id = ${ownFranchisorId}::uuid)
          AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography, ${Math.max(input.radiusM * 2, 5000)})`;
      const poiOwn = await prisma.$queryRaw<Row[]>`
        SELECT name, lat, lon, city FROM poi
        WHERE category = 'competitor' AND name ILIKE ${'%' + q + '%'} AND geom IS NOT NULL
          AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography, ${Math.max(input.radiusM * 2, 5000)})`;
      const seen = new Set<string>();
      for (const r of [...own, ...poiOwn]) {
        const k = `${r.lat.toFixed(4)}:${r.lon.toFixed(4)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        myOutlets.push({ name: r.name, lat: r.lat, lon: r.lon });
      }
      // Don't double-plot my own outlets as competitors.
      const ownKeys = new Set(myOutlets.map((o) => `${o.lat.toFixed(4)}:${o.lon.toFixed(4)}`));
      places = places.filter((p) => !ownKeys.has(`${p.lat.toFixed(4)}:${p.lon.toFixed(4)}`));
    }

    // Breakdown by category for the selected area/radius (before the max cap is fine —
    // recompute from the full radius set so the summary reflects everything present).
    const breakdownMap = new Map<string, { label: string; n: number }>();
    for (const r of rows.map(tag)) {
      const cur = breakdownMap.get(r.category) ?? { label: r.categoryLabel, n: 0 };
      cur.n += 1;
      breakdownMap.set(r.category, cur);
    }
    const breakdown = Array.from(breakdownMap.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.n }))
      .sort((a, b) => b.count - a.count);

    return ok({ mode: 'nearby', count: places.length, places, myOutlets, breakdown });
  }

  // Brand mode — name match across competitor POIs (shared reference) and the user's
  // OWN franchisor outlets. Outlet matches are scoped to the caller's franchisor so one
  // tenant can never enumerate another tenant's branch names/coordinates; staff match all.
  const q = input.query.trim();
  const isStaff = session.role === 'admin' || session.role === 'analyst';
  const ownFranchisorId = session.franchisorId ?? null;
  const poiRows = await prisma.$queryRaw<Row[]>`
    SELECT name, lat, lon, city FROM poi
    WHERE name ILIKE ${'%' + q + '%'} AND geom IS NOT NULL LIMIT ${input.max}`;
  const outletRows = (isStaff || ownFranchisorId)
    ? await prisma.$queryRaw<Row[]>`
        SELECT outlet_name AS name, lat, lon, NULL::text AS city FROM outlet
        WHERE outlet_name ILIKE ${'%' + q + '%'}
          AND (${isStaff}::boolean OR franchisor_id = ${ownFranchisorId}::uuid)
        LIMIT ${input.max}`
    : [];
  const seen = new Set<string>();
  const merged: Tagged[] = [];
  for (const r of [...poiRows, ...outletRows]) {
    const k = `${r.lat.toFixed(4)}:${r.lon.toFixed(4)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(tag(r));
    if (merged.length >= input.max) break;
  }
  return ok({ mode: 'brand', count: merged.length, places: merged, myOutlets: [], breakdown: [] });
}
