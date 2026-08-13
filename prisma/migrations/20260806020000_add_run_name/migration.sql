-- Add a user-facing name to each pipeline run so owners can tell reports apart.
ALTER TABLE "pipeline_run" ADD COLUMN IF NOT EXISTS "name" TEXT;
