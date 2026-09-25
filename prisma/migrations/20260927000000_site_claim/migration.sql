-- F-05: per-site claim so two concurrent pipeline invocations can't analyse the same site twice.
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "claimed_at" timestamptz(6);

-- The pipeline resumes on sites where analyzed_at IS NULL and claims them by claimed_at.
-- This partial index keeps the "unclaimed / stale-claim pending" scan cheap as runs grow.
CREATE INDEX IF NOT EXISTS "candidate_site_pending_idx"
  ON "candidate_site" ("pipeline_run_id")
  WHERE "analyzed_at" IS NULL;
