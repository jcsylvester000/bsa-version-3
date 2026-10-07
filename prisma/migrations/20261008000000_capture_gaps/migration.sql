-- 2026-10-08 — Place Capture: capture log + retry queue.
-- Idempotent (IF [NOT] EXISTS everywhere) so a partially-applied run can be re-deployed safely.

-- 1) Which layers a saved capture actually loaded completely (stamped as covered). `layers` keeps what
--    was asked for; a layer that failed or hit the place limit is in `layers` but not here.
ALTER TABLE "poi_capture_batch" ADD COLUMN IF NOT EXISTS "fetched_layers" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- 2) The retry queue: one row per (area, layer) that OpenStreetMap did not return completely.
DO $$ BEGIN
  CREATE TYPE "CaptureGapStatus" AS ENUM ('open', 'resolved', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "poi_capture_gap" (
  "id"                UUID NOT NULL DEFAULT gen_random_uuid(),
  "area_key"          TEXT NOT NULL,
  "layer"             TEXT NOT NULL,
  "label"             TEXT NOT NULL,
  "area_spec"         JSONB NOT NULL,
  "context"           JSONB,
  "area"              geography(Polygon, 4326),
  "lat"               DOUBLE PRECISION NOT NULL,
  "lon"               DOUBLE PRECISION NOT NULL,
  "reason"            TEXT NOT NULL,
  "message"           TEXT,
  "attempts"          INTEGER NOT NULL DEFAULT 1,
  "status"            "CaptureGapStatus" NOT NULL DEFAULT 'open',
  "created_by"        UUID,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "last_attempt_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "resolved_at"       TIMESTAMPTZ(6),
  "resolved_batch_id" UUID,
  CONSTRAINT "poi_capture_gap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "poi_capture_gap_reason_check" CHECK ("reason" IN ('timeout', 'limit', 'error'))
);
-- One OPEN row per area + layer: a repeated failure bumps `attempts` instead of adding rows.
CREATE UNIQUE INDEX IF NOT EXISTS "poi_capture_gap_open_key" ON "poi_capture_gap" ("area_key", "layer") WHERE "status" = 'open';
CREATE INDEX IF NOT EXISTS "poi_capture_gap_status_created_at_idx" ON "poi_capture_gap" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "poi_capture_gap_area_gist" ON "poi_capture_gap" USING GIST ("area");

DO $$ BEGIN
  ALTER TABLE "poi_capture_gap" ADD CONSTRAINT "poi_capture_gap_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "poi_capture_gap" ADD CONSTRAINT "poi_capture_gap_resolved_batch_id_fkey"
    FOREIGN KEY ("resolved_batch_id") REFERENCES "poi_capture_batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
