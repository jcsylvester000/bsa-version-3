-- Batch 4: Truth Layer data fix.
-- The demographics loader hard-coded truth_layer = 'verified', discarding the source's own
-- classification. Every row in prisma/data/demographics.real.json is marked 'assumed'
-- (PSA population, but centroid coordinates + estimated income/daytime bands), and the
-- sample file carries no label (→ assumed). So every stored 'verified' demographic row was
-- mislabelled. Idempotent. Re-run analyses afterwards so Site Fit picks up the new label.
UPDATE "demographic_cell" SET "truth_layer" = 'assumed' WHERE "truth_layer" = 'verified';
