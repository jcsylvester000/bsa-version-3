-- Batch 3: pipeline integrity + outlet ownership. Additive + idempotent (neon + docker).

-- 1) Per-site completion markers (resume on these, not on "any module_result row exists").
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "analyzed_at"    TIMESTAMPTZ(6);
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "pipeline_error" TEXT;

-- Backfill: sites that already have pipeline results count as analysed (keeps existing runs
-- as they are — use "Re-run analysis" to refresh them with the Batch 3 logic).
UPDATE "candidate_site" cs
SET "analyzed_at" = COALESCE(r."finished_at", now())
FROM "pipeline_run" r
WHERE cs."pipeline_run_id" = r."id"
  AND cs."analyzed_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "module_result" m
    WHERE m."candidate_site_id" = cs."id" AND m."module" <> 'analysis'
  );

-- Carry the old error sentinel (written into the territory row) onto the site.
UPDATE "candidate_site" cs
SET "pipeline_error" = 'pipeline: ' || COALESCE(m."payload"->>'detail', 'error')
FROM "module_result" m
WHERE m."candidate_site_id" = cs."id"
  AND m."module" = 'territory'
  AND 'pipeline_error' = ANY (m."flags")
  AND cs."pipeline_error" IS NULL;

-- 2) Outlet ownership: outlets typed into an intake belong to that intake.
ALTER TABLE "outlet" ADD COLUMN IF NOT EXISTS "intake_submission_id" UUID;
CREATE INDEX IF NOT EXISTS "outlet_intake_submission_id_idx" ON "outlet" ("intake_submission_id");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'outlet_intake_submission_id_fkey') THEN
    ALTER TABLE "outlet"
      ADD CONSTRAINT "outlet_intake_submission_id_fkey"
      FOREIGN KEY ("intake_submission_id") REFERENCES "intake_submission"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Backfill: the intake route writes outlets immediately after creating the intake, so an
-- outlet created within 5 minutes after a user intake for the same brand belongs to it
-- (nearest such intake wins). Seeded/ingested reference outlets are not created in that
-- window and stay NULL (= the brand's reference network).
UPDATE "outlet" o
SET "intake_submission_id" = pick."intake_id"
FROM (
  SELECT DISTINCT ON (o2."id") o2."id" AS "outlet_id", i."id" AS "intake_id"
  FROM "outlet" o2
  JOIN "intake_submission" i
    ON i."franchisor_id" = o2."franchisor_id"
   AND i."created_by_user_id" IS NOT NULL
   AND o2."created_at" >= i."created_at"
   AND o2."created_at" <  i."created_at" + INTERVAL '5 minutes'
  WHERE o2."intake_submission_id" IS NULL
  ORDER BY o2."id", o2."created_at" - i."created_at" ASC
) pick
WHERE o."id" = pick."outlet_id";
