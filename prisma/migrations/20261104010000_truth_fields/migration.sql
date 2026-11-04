-- Brief alignment Batch 2 (2026-11-04) — Truth Layer per field + 10-digit PSGC codes. Idempotent.

-- T-1 / T-4: per-field labels and census year on demographic_cell.
ALTER TABLE "demographic_cell" ADD COLUMN IF NOT EXISTS "population_truth" "TruthLayer";
ALTER TABLE "demographic_cell" ADD COLUMN IF NOT EXISTS "bands_truth" "TruthLayer";
ALTER TABLE "demographic_cell" ADD COLUMN IF NOT EXISTS "census_year" INTEGER;
ALTER TABLE "demographic_cell" ADD COLUMN IF NOT EXISTS "population_source" TEXT;

-- T-5: where each outlet came from + location / sales truth.
DO $$ BEGIN
  CREATE TYPE "OutletSource" AS ENUM ('brand_list', 'user_entry', 'reference');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "outlet" ADD COLUMN IF NOT EXISTS "source" "OutletSource" NOT NULL DEFAULT 'user_entry';
ALTER TABLE "outlet" ADD COLUMN IF NOT EXISTS "location_truth" "TruthLayer";
ALTER TABLE "outlet" ADD COLUMN IF NOT EXISTS "sales_truth" "TruthLayer";
-- Existing rows: no intake = the legacy seeded network ("reference"); intake rows were typed by a user.
-- Labels stay as stored (Assumed) — nothing is promoted to Verified without a brand-supplied list.
UPDATE "outlet" SET "source" = 'reference' WHERE "intake_submission_id" IS NULL AND "source" = 'user_entry';

-- T-3: PSGC codes are 10 digits. Boundaries loaded from the GeoJSON maps lost their leading zero
-- (Cavite "402101006" → "0402101006"). Pad 9-digit codes with no leading zero (old-scheme "04…" codes untouched).
UPDATE "admin_boundary" SET "parent_psgc" = lpad("parent_psgc", 10, '0') WHERE "parent_psgc" ~ '^[1-9][0-9]{8}$';
UPDATE "admin_boundary" SET "psgc_code" = lpad("psgc_code", 10, '0')
  WHERE "psgc_code" ~ '^[1-9][0-9]{8}$' AND NOT EXISTS (SELECT 1 FROM "admin_boundary" b2 WHERE b2."psgc_code" = lpad("admin_boundary"."psgc_code", 10, '0'));
UPDATE "poi" SET "psgc_code" = lpad("psgc_code", 10, '0') WHERE "psgc_code" ~ '^[1-9][0-9]{8}$';
UPDATE "candidate_site" SET "psgc_code" = lpad("psgc_code", 10, '0') WHERE "psgc_code" ~ '^[1-9][0-9]{8}$';
UPDATE "mall_property" SET "psgc_code" = lpad("psgc_code", 10, '0') WHERE "psgc_code" ~ '^[1-9][0-9]{8}$';
