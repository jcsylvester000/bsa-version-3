-- F-18: real POI provenance.
-- 1) Google becomes a first-class source (previously Google-sourced POIs were mislabelled 'manual').
ALTER TYPE "PoiSource" ADD VALUE IF NOT EXISTS 'google';

-- 2) Free-text provenance detail beyond the coarse source enum (e.g. "osm:overpass", "google:places").
ALTER TABLE "poi" ADD COLUMN IF NOT EXISTS "provenance" text;
