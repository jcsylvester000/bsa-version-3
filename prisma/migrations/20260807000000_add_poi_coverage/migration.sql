-- On-demand POI cache coverage log. Records which (grid cell, vertical) areas have been
-- pulled from OSM and when, so reports fetch from Overpass only on a miss / stale cell.
-- The poi rows it guards are shared platform-wide (self-warming cache).
CREATE TABLE IF NOT EXISTS "poi_coverage" (
  "id"         BIGSERIAL PRIMARY KEY,
  "cell_key"   TEXT NOT NULL,
  "vertical"   TEXT NOT NULL,
  "lat"        DOUBLE PRECISION NOT NULL,
  "lon"        DOUBLE PRECISION NOT NULL,
  "poi_count"  INTEGER NOT NULL DEFAULT 0,
  "fetched_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "source"     TEXT NOT NULL DEFAULT 'osm'
);

CREATE UNIQUE INDEX IF NOT EXISTS "poi_coverage_cell_vertical"
  ON "poi_coverage" ("cell_key", "vertical");
CREATE INDEX IF NOT EXISTS "poi_coverage_vertical_idx"
  ON "poi_coverage" ("vertical");
