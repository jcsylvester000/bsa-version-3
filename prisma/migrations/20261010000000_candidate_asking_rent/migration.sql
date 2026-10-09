-- 2026-10-10 — Asking rent per candidate site (broker decision: lower rent scores higher, so the
-- rent the broker is quoted should be captured at intake and survive every re-run).
-- Idempotent so a partially-applied deploy can be re-run safely.
ALTER TABLE "candidate_site" ADD COLUMN IF NOT EXISTS "asking_rent_php_sqm" DECIMAL(10, 2);
