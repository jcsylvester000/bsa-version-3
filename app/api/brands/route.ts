import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { BRAND_VERTICALS as CANDIDATES } from '@/lib/brands/brandVertical';
import { ok, errors } from '@/lib/api/respond';

/**
 * Comparable-brand picker source. Returns well-known chains — grouped by concept
 * category and each mapped to the intake vertical it best fits (from the shared
 * brand→vertical map) — but ONLY the ones that actually have establishments in the
 * database, with a live count. An independent operator picks the brand closest to
 * theirs so the scoring (competitor discrimination, daypart, lease corridor) adapts to
 * that concept. All from the DB, no Google calls.
 *
 * F-23: the counts are catalog-wide (not per-user) and change only when POIs are ingested, so:
 *  1) all brand counts are gathered in ONE table scan (a per-brand CASE aggregate) instead of one
 *     ILIKE scan per brand, and
 *  2) the built response is cached in memory for a few minutes. Franchise Screening then loads
 *     instantly, and a background POI ingest is reflected within the TTL.
 */

interface BrandsBody {
  groups: Array<{ category: string; brands: Array<{ brand: string; vertical: string; count: number }> }>;
  total: number;
}

const CACHE_TTL_MS = 5 * 60_000;
let cache: { at: number; body: BrandsBody } | null = null;

async function computeBrands(): Promise<BrandsBody> {
  // One scan: SUM(CASE WHEN name ILIKE pattern …) per candidate, aliased b0..bN. Prisma.raw is used
  // only for the integer-indexed alias identifier (never user input), values stay parameterised.
  const cols = CANDIDATES.map(
    (c, i) => Prisma.sql`SUM(CASE WHEN name ILIKE ${'%' + c.match + '%'} THEN 1 ELSE 0 END)::int AS ${Prisma.raw(`b${i}`)}`,
  );
  const rows = await prisma.$queryRaw<Array<Record<string, number>>>(
    Prisma.sql`SELECT ${Prisma.join(cols, ', ')} FROM poi`,
  );
  const counts = rows[0] ?? {};

  const groups: Record<string, Array<{ brand: string; vertical: string; count: number }>> = {};
  let total = 0;
  CANDIDATES.forEach((c, i) => {
    const n = counts[`b${i}`] ?? 0;
    if (n > 0) { (groups[c.category] ??= []).push({ brand: c.brand, vertical: c.vertical, count: n }); total++; }
  });
  return { groups: Object.entries(groups).map(([category, brands]) => ({ category, brands })), total };
}

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return ok(cache.body);
  const body = await computeBrands();
  cache = { at: Date.now(), body };
  return ok(body);
}
