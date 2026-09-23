/**
 * Shared "upsert one boundary feature" used by both the file loader (prisma/loadBoundaries.ts)
 * and the auto-downloader (prisma/fetchBoundaries.ts). Maps the feature's properties to a row
 * (lib/geo/boundaryFeature) and writes it, setting the geography from the feature geometry.
 * Uses the shared `prisma` singleton (the same one the scripts already import).
 */
import { prisma } from '@/lib/db/prisma';
import { boundaryFeatureToRow, type BoundaryLevel } from './boundaryFeature';

export interface BoundaryFeature {
  type?: string;
  properties?: Record<string, unknown>;
  geometry?: unknown;
}

/** Upsert one feature at `level`, tagged with the BSA `region`. Returns true if written. */
export async function upsertBoundaryFeature(
  feature: BoundaryFeature,
  level: BoundaryLevel,
  region: string,
): Promise<boolean> {
  const props = feature.properties ?? {};
  const row = boundaryFeatureToRow(props, level);
  if (!row || !feature.geometry) return false;
  await prisma.adminBoundary.upsert({
    where: { psgcCode: row.psgcCode },
    update: { level: row.level, name: row.name, parentPsgc: row.parentPsgc, region },
    create: { psgcCode: row.psgcCode, level: row.level, name: row.name, parentPsgc: row.parentPsgc, region },
  });
  const geomJson = JSON.stringify(feature.geometry);
  await prisma.$executeRaw`
    UPDATE admin_boundary
    SET geom = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geomJson}), 4326))::geography
    WHERE psgc_code = ${row.psgcCode}`;
  return true;
}
