-- Brief alignment Batch 3 (2026-11-04) — the 90-day refresh queues back-fill jobs with reason 'refresh'
-- (Brief C-4). Widen the reason check. Idempotent.
ALTER TABLE "poi_fill_job" DROP CONSTRAINT IF EXISTS "poi_fill_job_reason_check";
ALTER TABLE "poi_fill_job" ADD CONSTRAINT "poi_fill_job_reason_check"
  CHECK ("reason" IN ('intake', 'search', 'admin', 'refresh'));
