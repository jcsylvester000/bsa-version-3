import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { ok, errors } from '@/lib/api/respond';
import { categorizeByName } from '@/lib/places/competitorRelevance';

/**
 * DB-driven facets for the Explore tool. Returns:
 *  - areas:      every area (poi.city) that actually has competitor establishments,
 *                with its live count and a centroid (so the map can recenter on it).
 *  - categories: how many establishments fall in each concept category — computed by
 *                classifying real names, so the dropdown only offers categories that
 *                have data, with counts.
 * All from the database — no Google calls.
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const areaRows = await prisma.$queryRaw<Array<{ area: string; n: number; lat: number; lon: number }>>`
    SELECT city AS area, COUNT(*)::int AS n,
           ROUND(AVG(lat)::numeric, 4)::float8 AS lat,
           ROUND(AVG(lon)::numeric, 4)::float8 AS lon
    FROM poi
    WHERE category = 'competitor' AND city IS NOT NULL AND geom IS NOT NULL
    GROUP BY city
    ORDER BY n DESC`;

  // Category counts: classify every competitor name (single query, classify in JS).
  const names = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM poi WHERE category = 'competitor'`;
  const catCount = new Map<string, { label: string; n: number }>();
  for (const { name } of names) {
    const c = categorizeByName(name);
    const cur = catCount.get(c.key) ?? { label: c.label, n: 0 };
    cur.n += 1;
    catCount.set(c.key, cur);
  }
  const categories = Array.from(catCount.entries())
    .map(([key, v]) => ({ key, label: v.label, count: v.n }))
    .sort((a, b) => b.count - a.count);

  return ok({
    areas: areaRows.map((r) => ({ area: r.area, count: r.n, lat: r.lat, lon: r.lon })),
    categories,
    total: names.length,
  });
}
