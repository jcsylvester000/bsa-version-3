-- Pipeline (VectorShift) usage + cost log. Admin-only; append-only; stores NO response text.
-- One row per live external-AI run: cost + provider run id + who/when, for the usage monitor.
CREATE TABLE IF NOT EXISTS "pipeline_usage" (
  "id"                UUID NOT NULL,
  "user_id"           TEXT,
  "franchisor_id"     UUID,
  "pipeline_run_id"   UUID,
  "candidate_site_id" UUID,
  "provider"          TEXT NOT NULL DEFAULT 'vectorshift',
  "model"             TEXT,
  "vs_run_id"         TEXT,
  "cost_raw"          TEXT,
  "cost_value"        DECIMAL(14,6),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "pipeline_usage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pipeline_usage_user_id_idx"       ON "pipeline_usage" ("user_id");
CREATE INDEX IF NOT EXISTS "pipeline_usage_franchisor_id_idx" ON "pipeline_usage" ("franchisor_id");
CREATE INDEX IF NOT EXISTS "pipeline_usage_created_at_idx"    ON "pipeline_usage" ("created_at");
