-- R-01: region-aware columns on poi, candidate_site, mall_property.
-- Additive + idempotent. Backfills existing rows (NCR + Davao only today) by bounding box,
-- matching lib/geo/regions.ts. Cavite/Batangas rows arrive already tagged from the region-aware
-- ingest. Province is left NULL until R-02 assigns it from real PSGC boundaries.

ALTER TABLE "poi"            ADD COLUMN IF NOT EXISTS "region"   TEXT;
ALTER TABLE "poi"            ADD COLUMN IF NOT EXISTS "province" TEXT;
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "region"   TEXT;
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "province" TEXT;
ALTER TABLE "mall_property"  ADD COLUMN IF NOT EXISTS "region"   TEXT;
ALTER TABLE "mall_property"  ADD COLUMN IF NOT EXISTS "province" TEXT;

CREATE INDEX IF NOT EXISTS "poi_region_idx"            ON "poi" ("region");
CREATE INDEX IF NOT EXISTS "candidate_site_region_idx" ON "candidate_site" ("region");

-- Coarse bbox backfill (NCR box, then Davao box). Tighter/urban NCR checked first so a point
-- inside both leans NCR; the region-aware ingest tags new provincial rows precisely.
UPDATE "poi" SET "region" = 'ncr'
  WHERE "region" IS NULL AND "lat" BETWEEN 14.35 AND 14.78 AND "lon" BETWEEN 120.90 AND 121.15;
UPDATE "poi" SET "region" = 'davao'
  WHERE "region" IS NULL AND "lat" BETWEEN 6.70 AND 7.55 AND "lon" BETWEEN 125.20 AND 126.30;

UPDATE "candidate_site" SET "region" = 'ncr'
  WHERE "region" IS NULL AND "lat" BETWEEN 14.35 AND 14.78 AND "lon" BETWEEN 120.90 AND 121.15;
UPDATE "candidate_site" SET "region" = 'davao'
  WHERE "region" IS NULL AND "lat" BETWEEN 6.70 AND 7.55 AND "lon" BETWEEN 125.20 AND 126.30;

UPDATE "mall_property" SET "region" = 'ncr'
  WHERE "region" IS NULL AND "lat" BETWEEN 14.35 AND 14.78 AND "lon" BETWEEN 120.90 AND 121.15;
UPDATE "mall_property" SET "region" = 'davao'
  WHERE "region" IS NULL AND "lat" BETWEEN 6.70 AND 7.55 AND "lon" BETWEEN 125.20 AND 126.30;
