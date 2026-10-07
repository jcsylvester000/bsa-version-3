-- 2026-10-07 — Admin POI capture + OSM natural-key fix.
-- Idempotent (IF [NOT] EXISTS everywhere) so a partially-applied run can be re-deployed safely.

-- 1) poi: OSM element type + matched tag + capture/verification columns.
ALTER TABLE "poi" ADD COLUMN IF NOT EXISTS "osm_type" TEXT;
ALTER TABLE "poi" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "poi" ADD COLUMN IF NOT EXISTS "psgc_code" TEXT;  -- already added by 20260923000005; now modelled
ALTER TABLE "poi" ADD COLUMN IF NOT EXISTS "capture_batch_id" UUID;
ALTER TABLE "poi" ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMPTZ(6);
ALTER TABLE "poi" ADD COLUMN IF NOT EXISTS "verified_by" UUID;

DO $$ BEGIN
  ALTER TABLE "poi" ADD CONSTRAINT "poi_osm_type_check" CHECK ("osm_type" IS NULL OR "osm_type" IN ('node','way','relation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) Natural key: (osm_type, osm_id). OSM numbers nodes and ways independently, so the old unique
--    osm_id let node N overwrite way N. Legacy rows (osm_type NULL) stay unique on osm_id alone via a
--    partial index, and are claimed by the real element on the next ingest (lib/ingest/poiKeySql.ts).
DROP INDEX IF EXISTS "poi_osm_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "poi_osm_type_osm_id_key" ON "poi" ("osm_type", "osm_id");
CREATE UNIQUE INDEX IF NOT EXISTS "poi_osm_legacy_key" ON "poi" ("osm_id") WHERE "osm_type" IS NULL;
CREATE INDEX IF NOT EXISTS "poi_osm_id_idx" ON "poi" ("osm_id");
CREATE INDEX IF NOT EXISTS "poi_capture_batch_id_idx" ON "poi" ("capture_batch_id");

-- 3) Capture staging.
DO $$ BEGIN
  CREATE TYPE "CaptureStatus" AS ENUM ('draft', 'committed', 'discarded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE "CaptureDecision" AS ENUM ('pending', 'accept', 'reject');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "poi_capture_batch" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "label"           TEXT NOT NULL,
  "source"          TEXT NOT NULL,
  "area"            geography(Polygon, 4326),
  "area_spec"       JSONB,
  "layers"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"          "CaptureStatus" NOT NULL DEFAULT 'draft',
  "item_count"      INTEGER NOT NULL DEFAULT 0,
  "committed_count" INTEGER NOT NULL DEFAULT 0,
  "notes"           TEXT,
  "created_by"      UUID,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "committed_by"    UUID,
  "committed_at"    TIMESTAMPTZ(6),
  CONSTRAINT "poi_capture_batch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "poi_capture_batch_source_check" CHECK ("source" IN ('osm', 'navigator_import', 'manual'))
);
CREATE INDEX IF NOT EXISTS "poi_capture_batch_status_created_at_idx" ON "poi_capture_batch" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "poi_capture_batch_area_gist" ON "poi_capture_batch" USING GIST ("area");

CREATE TABLE IF NOT EXISTS "poi_capture_item" (
  "id"                  BIGSERIAL NOT NULL,
  "batch_id"            UUID NOT NULL,
  "osm_type"            TEXT,
  "osm_id"              BIGINT,
  "name"                TEXT NOT NULL,
  "kind"                TEXT,
  "category"            "PoiCategory" NOT NULL,
  "lat"                 DOUBLE PRECISION NOT NULL,
  "lon"                 DOUBLE PRECISION NOT NULL,
  "source"              "PoiSource" NOT NULL,
  "truth_layer"         "TruthLayer" NOT NULL,
  "decision"            "CaptureDecision" NOT NULL DEFAULT 'accept',
  "existing_poi_id"     BIGINT,
  "duplicate_of_poi_id" BIGINT,
  "notes"               TEXT,
  "committed_poi_id"    BIGINT,
  CONSTRAINT "poi_capture_item_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "poi_capture_item_batch_id_decision_idx" ON "poi_capture_item" ("batch_id", "decision");

DO $$ BEGIN
  ALTER TABLE "poi_capture_item" ADD CONSTRAINT "poi_capture_item_batch_id_fkey"
    FOREIGN KEY ("batch_id") REFERENCES "poi_capture_batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "poi_capture_batch" ADD CONSTRAINT "poi_capture_batch_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "poi" ADD CONSTRAINT "poi_capture_batch_id_fkey"
    FOREIGN KEY ("capture_batch_id") REFERENCES "poi_capture_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
