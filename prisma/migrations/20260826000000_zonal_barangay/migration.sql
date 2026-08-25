-- Zonal Value: add barangay grain, make rdo NOT NULL default '', widen the natural key.
-- Additive + idempotent so it is safe to apply to the live neon DB and to re-run.

-- 1. Barangay grain. '' (empty) = a city-level row; a name = a barangay-level row.
ALTER TABLE "zonal_value" ADD COLUMN IF NOT EXISTS "barangay" TEXT NOT NULL DEFAULT '';

-- 2. rdo: backfill NULLs to '' then make NOT NULL DEFAULT '' (so it never breaks the unique key).
UPDATE "zonal_value" SET "rdo" = '' WHERE "rdo" IS NULL;
ALTER TABLE "zonal_value" ALTER COLUMN "rdo" SET DEFAULT '';
ALTER TABLE "zonal_value" ALTER COLUMN "rdo" SET NOT NULL;

-- 3. Replace the OLD unique natural-key index (whatever it is named in this env) with the
--    new one that includes barangay. The DO block finds the old index by shape, so it works
--    regardless of Prisma's generated name across neon/docker.
DO $$
DECLARE idx text;
BEGIN
  SELECT indexname INTO idx FROM pg_indexes
   WHERE schemaname = current_schema()
     AND tablename = 'zonal_value'
     AND indexdef ILIKE '%UNIQUE%'
     AND indexdef ILIKE '%classification_code%'
     AND indexdef NOT ILIKE '%barangay%'
   LIMIT 1;
  IF idx IS NOT NULL THEN EXECUTE format('DROP INDEX %I', idx); END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "zonal_value_natural_key"
  ON "zonal_value" ("region", "city_municipality", "barangay", "rdo", "classification_code");

-- 4. Secondary lookup index for barangay resolution.
CREATE INDEX IF NOT EXISTS "zonal_value_city_barangay_idx"
  ON "zonal_value" ("region", "city_municipality", "barangay");
