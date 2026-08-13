-- NCR/Davao corridor traffic + seasonality reference for the Land & Traffic screen.
-- Replaces the POI-count traffic proxy with an AADT-anchored base band plus seasonal
-- low/high multipliers (Christmas / Undas / Holy Week / payday / school-open). Modelled
-- range, not a live count — Truth Layer per row.
CREATE TABLE "traffic_corridor" (
    "id" BIGSERIAL NOT NULL,
    "corridor" TEXT NOT NULL,
    "base_band" "FootfallBand" NOT NULL,
    "aadt_ref" INTEGER,
    "seasonal" JSONB NOT NULL,
    "truth_layer" "TruthLayer" NOT NULL DEFAULT 'assumed',
    "notes" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_corridor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "traffic_corridor_corridor_key" ON "traffic_corridor"("corridor");
