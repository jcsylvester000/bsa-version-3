-- Brand privacy: record which user created a franchisor from the app. A non-null creator
-- makes the brand private to that user (+ staff); NULL = shared seeded catalog.
-- Additive + idempotent: safe to run on neon and local docker.

ALTER TABLE "franchisor" ADD COLUMN IF NOT EXISTS "created_by_user_id" UUID;
CREATE INDEX IF NOT EXISTS "franchisor_created_by_user_id_idx" ON "franchisor" ("created_by_user_id");

-- Backfill 1: brands added from the intake screen carry "Added via intake by <email>".
UPDATE "franchisor" f
SET "created_by_user_id" = u."id"
FROM "app_user" u
WHERE f."created_by_user_id" IS NULL
  AND f."positioning" = 'Added via intake by ' || u."email";

-- Backfill 2: independent businesses ("Independent · benchmarked against …") belong to
-- the user who created their first run.
UPDATE "franchisor" f
SET "created_by_user_id" = sub."uid"
FROM (
  SELECT DISTINCT ON ("franchisor_id") "franchisor_id", "created_by_user_id" AS "uid"
  FROM "pipeline_run"
  WHERE "created_by_user_id" IS NOT NULL
  ORDER BY "franchisor_id", "created_at" ASC
) sub
WHERE f."id" = sub."franchisor_id"
  AND f."created_by_user_id" IS NULL
  AND f."positioning" LIKE 'Independent ·%';
