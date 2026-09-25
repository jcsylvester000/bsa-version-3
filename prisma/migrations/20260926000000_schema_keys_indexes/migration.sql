-- Audit F-12 / F-21: performance indexes, a region column for scoped reads, and cleanup of a
-- duplicate spatial index. All idempotent and non-destructive (safe to re-run / deploy).

-- module_result is filtered by pipeline_run_id on every dashboard load, in the report composer,
-- and by the ON DELETE CASCADE from pipeline_run — but had no index on that column.
CREATE INDEX IF NOT EXISTS "module_result_pipeline_run_id_idx" ON "module_result" ("pipeline_run_id");

-- demographic_cell gains a PSA region column (e.g. 'NCR', 'IV-A') so catchment / white-space reads
-- can be scoped to the site's region instead of scanning every region's cells.
ALTER TABLE "demographic_cell" ADD COLUMN IF NOT EXISTS "region" text;
CREATE INDEX IF NOT EXISTS "demographic_cell_region_idx" ON "demographic_cell" ("region");

-- Drop the duplicate GiST index on demographic_cell.geom. The init migration created
-- "demographic_cell_geom_gist"; the MultiPolygon migration added "demographic_cell_geom_gix".
-- Keep the newer one, drop the old duplicate.
DROP INDEX IF EXISTS "demographic_cell_geom_gist";
