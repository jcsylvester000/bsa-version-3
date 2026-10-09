-- 2026-10-09 — Location demand tracking + automated POI back-fill.
-- Idempotent (IF [NOT] EXISTS everywhere) so a partially-applied run can be re-deployed safely.

-- 1) What users look for: address searches and intake sites, with the data BSA had there at that moment.
CREATE TABLE IF NOT EXISTS "location_demand" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "kind"            TEXT NOT NULL,
  "user_id"         UUID,
  "franchisor_id"   UUID,
  "query"           TEXT,
  "label"           TEXT,
  "lat"             DOUBLE PRECISION NOT NULL,
  "lon"             DOUBLE PRECISION NOT NULL,
  "cell_key"        TEXT NOT NULL,
  "barangay"        TEXT,
  "city"            TEXT,
  "province"        TEXT,
  "region"          TEXT,
  "vertical"        TEXT,
  "run_id"          UUID,
  "site_id"         UUID,
  "places_nearby"   INTEGER NOT NULL DEFAULT 0,
  "coverage_status" TEXT NOT NULL,
  "fill_job_id"     UUID,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "location_demand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "location_demand_kind_check" CHECK ("kind" IN ('search', 'intake_site')),
  CONSTRAINT "location_demand_status_check" CHECK ("coverage_status" IN ('covered', 'partial', 'gap'))
);
CREATE INDEX IF NOT EXISTS "location_demand_created_at_idx" ON "location_demand" ("created_at");
CREATE INDEX IF NOT EXISTS "location_demand_cell_key_idx" ON "location_demand" ("cell_key");
CREATE INDEX IF NOT EXISTS "location_demand_status_idx" ON "location_demand" ("coverage_status", "created_at");
DO $$ BEGIN
  ALTER TABLE "location_demand" ADD CONSTRAINT "location_demand_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2) The automated back-fill queue: one job per ~1 km area that users need but BSA has no places for.
DO $$ BEGIN
  CREATE TYPE "FillJobStatus" AS ENUM ('queued', 'running', 'done', 'partial', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "poi_fill_job" (
  "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
  "area_key"        TEXT NOT NULL,
  "label"           TEXT NOT NULL,
  "lat"             DOUBLE PRECISION NOT NULL,
  "lon"             DOUBLE PRECISION NOT NULL,
  "radius_m"        INTEGER NOT NULL,
  "layers"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "layers_done"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "layers_failed"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status"          "FillJobStatus" NOT NULL DEFAULT 'queued',
  "reason"          TEXT NOT NULL,
  "demand_count"    INTEGER NOT NULL DEFAULT 1,
  "run_ids"         UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "places_saved"    INTEGER NOT NULL DEFAULT 0,
  "last_error"      TEXT,
  "created_by"      UUID,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "started_at"      TIMESTAMPTZ(6),
  "finished_at"     TIMESTAMPTZ(6),
  CONSTRAINT "poi_fill_job_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "poi_fill_job_reason_check" CHECK ("reason" IN ('intake', 'search', 'admin'))
);
-- One OPEN job per area: more demand there bumps `demand_count` instead of queueing again.
CREATE UNIQUE INDEX IF NOT EXISTS "poi_fill_job_open_key" ON "poi_fill_job" ("area_key") WHERE "status" IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS "poi_fill_job_due_idx" ON "poi_fill_job" ("status", "next_attempt_at");
DO $$ BEGIN
  ALTER TABLE "poi_fill_job" ADD CONSTRAINT "poi_fill_job_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Runs that were analysed before their area had place data: refreshed automatically once it arrives.
ALTER TABLE "pipeline_run" ADD COLUMN IF NOT EXISTS "data_pending_at" TIMESTAMPTZ(6);
ALTER TABLE "pipeline_run" ADD COLUMN IF NOT EXISTS "data_refresh_state" TEXT;
ALTER TABLE "pipeline_run" ADD COLUMN IF NOT EXISTS "data_refreshed_at" TIMESTAMPTZ(6);
