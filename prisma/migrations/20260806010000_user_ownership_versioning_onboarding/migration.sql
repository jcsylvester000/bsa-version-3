-- User ownership, run versioning, and onboarding flag.
ALTER TABLE "app_user" ADD COLUMN "has_onboarded" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "intake_submission" ADD COLUMN "created_by_user_id" UUID;
ALTER TABLE "intake_submission" ADD COLUMN "parent_intake_id" UUID;
ALTER TABLE "intake_submission" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "pipeline_run" ADD COLUMN "created_by_user_id" UUID;
CREATE INDEX "intake_submission_created_by_user_id_idx" ON "intake_submission"("created_by_user_id");
CREATE INDEX "intake_submission_parent_intake_id_idx" ON "intake_submission"("parent_intake_id");
CREATE INDEX "pipeline_run_created_by_user_id_idx" ON "pipeline_run"("created_by_user_id");
