-- R-04: widen demographic_cell.geom to MultiPolygon so it can hold real barangay boundaries
-- (from admin_boundary), not just the legacy 600 m circle. Existing Polygon rows are coerced
-- with ST_Multi. Idempotent (only alters when the column isn't already MultiPolygon).

DO $$
DECLARE
  gtype text;
BEGIN
  SELECT type INTO gtype FROM geometry_columns
    WHERE f_table_name = 'demographic_cell' AND f_geometry_column = 'geom';
  -- geometry_columns may not list geography; guard by catching and forcing the ALTER anyway.
  IF gtype IS NULL OR gtype <> 'MultiPolygon' THEN
    BEGIN
      ALTER TABLE "demographic_cell"
        ALTER COLUMN "geom" TYPE geography(MultiPolygon, 4326)
        USING ST_Multi(geom::geometry)::geography;
    EXCEPTION WHEN others THEN
      -- Already MultiPolygon (or no rows/type info) — nothing to do.
      NULL;
    END;
  END IF;
END $$;

-- GiST index (recreate in case the type change dropped it).
CREATE INDEX IF NOT EXISTS "demographic_cell_geom_gix" ON "demographic_cell" USING GIST ("geom");
