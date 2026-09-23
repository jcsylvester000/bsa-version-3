-- AI usage log: record failures, latency and trigger (initial vs regenerate) so cost and
-- reliability are observable, and so the per-site regenerate cap can be enforced.
-- Additive + idempotent.
ALTER TABLE "pipeline_usage" ADD COLUMN IF NOT EXISTS "status"     TEXT NOT NULL DEFAULT 'ok';
ALTER TABLE "pipeline_usage" ADD COLUMN IF NOT EXISTS "error_code" TEXT;
ALTER TABLE "pipeline_usage" ADD COLUMN IF NOT EXISTS "latency_ms" INTEGER;
ALTER TABLE "pipeline_usage" ADD COLUMN IF NOT EXISTS "trigger"    TEXT NOT NULL DEFAULT 'initial';
CREATE INDEX IF NOT EXISTS "pipeline_usage_candidate_site_id_created_at_idx"
  ON "pipeline_usage" ("candidate_site_id", "created_at");
