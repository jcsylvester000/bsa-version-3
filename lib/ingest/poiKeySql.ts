/**
 * POI natural-key SQL (2026-10-07 node/way fix). Shared by the bulk loader, the on-demand cache
 * and the admin capture commit, so every write path claims legacy rows the same way.
 *
 * Background: `poi.osm_id` used to be the only key, but OSM numbers nodes and ways independently,
 * so node 123 and way 123 collided and the upsert overwrote one place with another. The key is now
 * (osm_type, osm_id). Rows written before the fix have osm_type NULL; when a typed element arrives
 * with the same id and sits within 150 m of that legacy row, it "claims" it (sets osm_type) so the
 * upsert updates the row in place instead of inserting a duplicate. A legacy row that belonged to
 * the OTHER element type is left alone (it is too far away), and is refreshed when that element
 * arrives.
 */
import { Prisma } from '@prisma/client';

export interface OsmKeyedPoint {
  osmType: 'node' | 'way' | 'relation';
  osmId: number | bigint;
  lat: number;
  lon: number;
}

/** Metres within which a typed element may claim a legacy (typeless) row with the same id. */
export const LEGACY_CLAIM_RADIUS_M = 150;

export function claimLegacyOsmSql(points: OsmKeyedPoint[]): Prisma.Sql {
  if (!points.length) return Prisma.sql`SELECT 1`;
  const values = Prisma.join(
    points.map((p) => Prisma.sql`(${p.osmType}::text, ${BigInt(p.osmId)}::bigint, ${p.lat}::float8, ${p.lon}::float8)`),
  );
  return Prisma.sql`
    UPDATE poi p SET osm_type = v.t
    FROM (VALUES ${values}) AS v(t, oid, lat, lon)
    WHERE p.osm_type IS NULL AND p.osm_id = v.oid AND p.geom IS NOT NULL
      AND ST_DWithin(p.geom, ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326)::geography, ${LEGACY_CLAIM_RADIUS_M})
      AND NOT EXISTS (SELECT 1 FROM poi q WHERE q.osm_type = v.t AND q.osm_id = v.oid)`;
}
