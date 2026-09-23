/**
 * R-02 — tag POIs, candidate sites and malls with their real barangay / city / province / PSGC
 * from admin_boundary, by point-in-polygon.
 *
 *   npm run db:tag-boundaries            # only rows not yet tagged (psgc_code IS NULL)
 *   npm run db:tag-boundaries -- --all   # re-tag every row (after a boundary refresh)
 *
 * Requires admin_boundary to be loaded first (prisma/loadBoundaries.ts). A LATERAL LIMIT 1 picks
 * exactly one barangay per point (points on a shared border resolve to one, deterministically by
 * index scan). Uses ST_Intersects on geography (GiST-indexed). Idempotent.
 */
import 'dotenv/config';
import { prisma } from '@/lib/db/prisma';

async function main() {
  const all = process.argv.includes('--all');
  console.log(`Tagging points by admin_boundary (${all ? 'ALL rows' : 'only untagged rows'})…`);

  const poi = await prisma.$executeRaw`
    UPDATE poi p SET
      psgc_code = sub.psgc, barangay = sub.bgy, city = sub.city, province = sub.prov,
      region = COALESCE(p.region, sub.region)
    FROM (
      SELECT p2.id AS pid, b.psgc_code AS psgc, b.name AS bgy, b.region AS region,
             c.name AS city, pr.name AS prov
      FROM poi p2
      JOIN LATERAL (
        SELECT ab.* FROM admin_boundary ab
        WHERE ab.level = 'barangay' AND ab.geom IS NOT NULL AND ST_Intersects(ab.geom, p2.geom)
        LIMIT 1
      ) b ON true
      LEFT JOIN admin_boundary c  ON c.psgc_code  = b.parent_psgc
      LEFT JOIN admin_boundary pr ON pr.psgc_code = c.parent_psgc
      WHERE p2.geom IS NOT NULL AND (p2.psgc_code IS NULL OR ${all})
    ) sub
    WHERE p.id = sub.pid`;
  console.log(`  poi: ${poi} rows tagged`);

  const sites = await prisma.$executeRaw`
    UPDATE candidate_site s SET
      psgc_code = sub.psgc, barangay = sub.bgy, city = sub.city, province = sub.prov,
      region = COALESCE(s.region, sub.region)
    FROM (
      SELECT s2.id AS sid, b.psgc_code AS psgc, b.name AS bgy, b.region AS region,
             c.name AS city, pr.name AS prov
      FROM candidate_site s2
      JOIN LATERAL (
        SELECT ab.* FROM admin_boundary ab
        WHERE ab.level = 'barangay' AND ab.geom IS NOT NULL AND ST_Intersects(ab.geom, s2.geom)
        LIMIT 1
      ) b ON true
      LEFT JOIN admin_boundary c  ON c.psgc_code  = b.parent_psgc
      LEFT JOIN admin_boundary pr ON pr.psgc_code = c.parent_psgc
      WHERE s2.geom IS NOT NULL AND (s2.psgc_code IS NULL OR ${all})
    ) sub
    WHERE s.id = sub.sid`;
  console.log(`  candidate_site: ${sites} rows tagged`);

  const malls = await prisma.$executeRaw`
    UPDATE mall_property m SET
      psgc_code = sub.psgc, city = sub.city, province = sub.prov,
      region = COALESCE(m.region, sub.region)
    FROM (
      SELECT m2.id AS mid, b.psgc_code AS psgc, b.region AS region,
             c.name AS city, pr.name AS prov
      FROM mall_property m2
      JOIN LATERAL (
        SELECT ab.* FROM admin_boundary ab
        WHERE ab.level = 'barangay' AND ab.geom IS NOT NULL AND ST_Intersects(ab.geom, m2.geom)
        LIMIT 1
      ) b ON true
      LEFT JOIN admin_boundary c  ON c.psgc_code  = b.parent_psgc
      LEFT JOIN admin_boundary pr ON pr.psgc_code = c.parent_psgc
      WHERE m2.geom IS NOT NULL AND (m2.psgc_code IS NULL OR ${all})
    ) sub
    WHERE m.id = sub.mid`;
  console.log(`  mall_property: ${malls} rows tagged`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
