-- R-02: official PSA administrative boundaries + PSGC columns for point-in-polygon tagging.
-- Additive + idempotent (neon + docker). Geometry columns are geography(MultiPolygon) with a
-- GiST index; Prisma models them Unsupported(), so the DDL lives here.

CREATE TABLE IF NOT EXISTS "admin_boundary" (
  "psgc_code"   TEXT NOT NULL,
  "level"       TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "parent_psgc" TEXT,
  "region"      TEXT,
  "truth_layer" "TruthLayer" NOT NULL DEFAULT 'verified',
  CONSTRAINT "admin_boundary_pkey" PRIMARY KEY ("psgc_code")
);

-- geography(MultiPolygon,4326) added separately (PostGIS type; not expressible in the CREATE above).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'admin_boundary' AND column_name = 'geom'
  ) THEN
    ALTER TABLE "admin_boundary" ADD COLUMN "geom" geography(MultiPolygon, 4326);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "admin_boundary_geom_gix"     ON "admin_boundary" USING GIST ("geom");
CREATE INDEX IF NOT EXISTS "admin_boundary_level_idx"    ON "admin_boundary" ("level");
CREATE INDEX IF NOT EXISTS "admin_boundary_region_lvl"   ON "admin_boundary" ("region", "level");
CREATE INDEX IF NOT EXISTS "admin_boundary_parent_idx"   ON "admin_boundary" ("parent_psgc");

-- PSGC code carried onto the points that get tagged by boundary (R-02 backfill / runtime lookup).
ALTER TABLE "poi"            ADD COLUMN IF NOT EXISTS "psgc_code" TEXT;
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "psgc_code" TEXT;
ALTER TABLE "mall_property"  ADD COLUMN IF NOT EXISTS "psgc_code" TEXT;
