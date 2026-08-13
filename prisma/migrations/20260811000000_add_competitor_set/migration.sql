-- Competitor set (cannibalization map): per anchor brand, the trade-area competitive
-- set that shares demand. Sourced from the GPV Franchise Intelligence Cannibalization
-- Map. Powers Territory Guard's competitor-density cannibalization read so a NEW brand
-- with no own outlets is no longer scored as 0% overlap. Truth Layer per row.
CREATE TABLE "competitor_set" (
    "id" BIGSERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "concept_key" TEXT NOT NULL,
    "anchor_brand" TEXT NOT NULL,
    "parent_operator" TEXT,
    "sub_segment" TEXT,
    "format_tier" TEXT,
    "competitors" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "truth_layer" "TruthLayer" NOT NULL DEFAULT 'assumed',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_set_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "competitor_set_anchor_brand_key" ON "competitor_set"("anchor_brand");
CREATE INDEX "competitor_set_concept_key_idx" ON "competitor_set"("concept_key");
