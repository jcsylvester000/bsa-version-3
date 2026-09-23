/**
 * Runtime boundary lookup — the barangay / city / province / PSGC for a coordinate, from the
 * loaded admin_boundary polygons (R-02). Server-only; one indexed ST_Intersects query.
 *
 * Best-effort: returns null when boundaries aren't loaded yet or the point is outside every
 * polygon, so callers fall back to the coarse region (lib/geo/regions). Used by the intake route
 * to stamp a real barangay on each candidate site the moment boundaries exist.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';

export interface ResolvedBoundary {
  psgcCode: string;
  barangay: string | null;
  city: string | null;
  province: string | null;
  region: string | null;
}

export async function resolveAdminBoundary(lat: number, lon: number): Promise<ResolvedBoundary | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  try {
    const rows = await prisma.$queryRaw<Array<{ psgc: string; bgy: string | null; city: string | null; prov: string | null; region: string | null }>>`
      SELECT b.psgc_code AS psgc, b.name AS bgy, b.region AS region,
             c.name AS city, pr.name AS prov
      FROM admin_boundary b
      LEFT JOIN admin_boundary c  ON c.psgc_code  = b.parent_psgc
      LEFT JOIN admin_boundary pr ON pr.psgc_code = c.parent_psgc
      WHERE b.level = 'barangay' AND b.geom IS NOT NULL
        AND ST_Intersects(b.geom, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography)
      LIMIT 1`;
    const r = rows[0];
    if (!r) return null;
    return { psgcCode: r.psgc, barangay: r.bgy, city: r.city, province: r.prov, region: r.region };
  } catch (e) {
    // A missing table (boundaries not loaded / migration pending) must never break intake.
    console.error('[adminBoundary] lookup failed', e);
    return null;
  }
}
