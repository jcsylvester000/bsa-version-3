-- Brief alignment S-3: per-site confidence + evidence + on-site visit reasons (idempotent).
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "confidence" "Confidence";
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "evidence" DECIMAL(4,3);
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "site_visit_reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
