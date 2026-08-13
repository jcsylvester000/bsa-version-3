-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "TruthLayer" AS ENUM ('verified', 'assumed', 'projected');

-- CreateEnum
CREATE TYPE "Sector" AS ENUM ('FnB', 'Retail', 'Services');

-- CreateEnum
CREATE TYPE "Vertical" AS ENUM ('fnb_qsr', 'fnb_cafe', 'fnb_bakery', 'retail_apparel', 'retail_specialty', 'services_salon', 'services_spa', 'services_fitness', 'services_laundry', 'convenience', 'remittance', 'pharmacy', 'diagnostics', 'fuel', 'automotive', 'hotel', 'education', 'other');

-- CreateEnum
CREATE TYPE "IntakeStatus" AS ENUM ('draft', 'validated', 'submitted');

-- CreateEnum
CREATE TYPE "OutletStatus" AS ENUM ('open', 'closed', 'renovating');

-- CreateEnum
CREATE TYPE "PerformanceTag" AS ENUM ('hero', 'above', 'avg', 'below', 'problem');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'researching', 'analyzing', 'composing', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('high', 'med', 'low');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('go', 'caution', 'nogo');

-- CreateEnum
CREATE TYPE "ModuleKind" AS ENUM ('site_fit', 'financial', 'risk', 'calibration', 'territory', 'lease', 'daypart', 'whitespace', 'mall', 'healthcare', 'informal');

-- CreateEnum
CREATE TYPE "PoiCategory" AS ENUM ('competitor', 'anchor', 'transport', 'school', 'hospital', 'clinic', 'diagnostic', 'mall', 'office', 'residential', 'other');

-- CreateEnum
CREATE TYPE "PoiSource" AS ENUM ('osm', 'manual');

-- CreateEnum
CREATE TYPE "MallTier" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "FootfallBand" AS ENUM ('very_high', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('pdf', 'docx');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'analyst', 'broker', 'franchisor');

-- CreateEnum
CREATE TYPE "AiPurpose" AS ENUM ('verdict', 'summary', 'section');

-- CreateTable
CREATE TABLE "franchisor" (
    "id" UUID NOT NULL,
    "brand_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "sector" "Sector" NOT NULL,
    "sub_category" TEXT,
    "positioning" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "franchisor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_submission" (
    "id" UUID NOT NULL,
    "franchisor_id" UUID NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "completeness_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "section_a" JSONB,
    "section_b" JSONB,
    "section_c" JSONB,
    "section_d" JSONB,
    "section_e" JSONB,
    "section_f" JSONB,
    "section_g" JSONB,
    "section_h" JSONB,
    "section_i" JSONB,
    "section_j" JSONB,
    "section_k" JSONB,
    "status" "IntakeStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outlet" (
    "id" UUID NOT NULL,
    "franchisor_id" UUID NOT NULL,
    "outlet_name" TEXT NOT NULL,
    "format" TEXT,
    "status" "OutletStatus" NOT NULL DEFAULT 'open',
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "floor_area_sqm" DECIMAL(10,2),
    "monthly_sales_php" DECIMAL(14,2),
    "avg_ticket_php" DECIMAL(10,2),
    "monthly_rent_php" DECIMAL(12,2),
    "performance_tag" "PerformanceTag",
    "opening_date" DATE,
    "truth_layer" "TruthLayer" NOT NULL DEFAULT 'assumed',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outlet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_site" (
    "id" UUID NOT NULL,
    "pipeline_run_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT,
    "barangay" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "site_type" TEXT,
    "composite_score" DECIMAL(6,2),
    "verdict" "Verdict",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidate_site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poi" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PoiCategory" NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lon" DOUBLE PRECISION NOT NULL,
    "geom" geography(Point, 4326),
    "city" TEXT,
    "barangay" TEXT,
    "source" "PoiSource" NOT NULL DEFAULT 'osm',
    "truth_layer" "TruthLayer" NOT NULL DEFAULT 'verified',
    "osm_id" BIGINT,

    CONSTRAINT "poi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "zonal_value" (
    "id" BIGSERIAL NOT NULL,
    "region" TEXT NOT NULL,
    "province" TEXT,
    "city_municipality" TEXT NOT NULL,
    "rdo" TEXT,
    "classification_code" TEXT NOT NULL,
    "low_php_sqm" DECIMAL(12,2),
    "high_php_sqm" DECIMAL(12,2),
    "truth_layer" "TruthLayer" NOT NULL DEFAULT 'verified',
    "notes" TEXT,

    CONSTRAINT "zonal_value_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_comp" (
    "id" BIGSERIAL NOT NULL,
    "format" TEXT NOT NULL,
    "corridor" TEXT NOT NULL,
    "mall_name" TEXT,
    "base_rent_php_sqm" DECIMAL(10,2),
    "escalation_pct" DECIMAL(5,2),
    "cusa_php_sqm" DECIMAL(10,2),
    "lease_term_years" INTEGER,
    "fitout_months" INTEGER,
    "observed_date" DATE,
    "truth_layer" "TruthLayer" NOT NULL DEFAULT 'verified',
    "sample_source" TEXT,

    CONSTRAINT "lease_comp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mall_property" (
    "id" BIGSERIAL NOT NULL,
    "mall_name" TEXT NOT NULL,
    "city" TEXT,
    "tier" "MallTier" NOT NULL,
    "footfall_band" "FootfallBand" NOT NULL,
    "rent_band_php_sqm" TEXT,
    "cusa_band" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "geom" geography(Point, 4326),
    "truth_layer" "TruthLayer" NOT NULL DEFAULT 'assumed',

    CONSTRAINT "mall_property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demographic_cell" (
    "id" BIGSERIAL NOT NULL,
    "psgc_code" TEXT NOT NULL,
    "barangay" TEXT,
    "city" TEXT,
    "population" INTEGER,
    "income_band" TEXT,
    "age_profile" JSONB,
    "renter_share_pct" DECIMAL(5,2),
    "daytime_pop" INTEGER,
    "geom" geography(Polygon, 4326),
    "truth_layer" "TruthLayer" NOT NULL DEFAULT 'verified',

    CONSTRAINT "demographic_cell_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_run" (
    "id" UUID NOT NULL,
    "intake_submission_id" UUID NOT NULL,
    "franchisor_id" UUID NOT NULL,
    "vertical" "Vertical" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "confidence" "Confidence",
    "exclusivity_radius_m" INTEGER NOT NULL DEFAULT 1500,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "module_result" (
    "id" UUID NOT NULL,
    "candidate_site_id" UUID NOT NULL,
    "pipeline_run_id" UUID NOT NULL,
    "module" "ModuleKind" NOT NULL,
    "score" DECIMAL(6,2),
    "payload" JSONB,
    "truth_layer" "TruthLayer" NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "module_result_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" UUID NOT NULL,
    "pipeline_run_id" UUID NOT NULL,
    "storage_key" TEXT,
    "format" "ReportFormat" NOT NULL DEFAULT 'pdf',
    "confidence" "Confidence",
    "generated_at" TIMESTAMPTZ(6),

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_chunk" (
    "id" BIGSERIAL NOT NULL,
    "source_table" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL,
    "embedding" vector(1536),
    "truth_layer" "TruthLayer" NOT NULL,
    "tsv" tsvector,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generation" (
    "id" UUID NOT NULL,
    "pipeline_run_id" UUID,
    "purpose" "AiPurpose" NOT NULL,
    "retrieved_chunk_ids" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "output" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL,
    "email" CITEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "franchisor_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "franchisor_sector_sub_category_idx" ON "franchisor"("sector", "sub_category");

-- CreateIndex
CREATE INDEX "intake_submission_franchisor_id_idx" ON "intake_submission"("franchisor_id");

-- CreateIndex
CREATE INDEX "intake_submission_status_idx" ON "intake_submission"("status");

-- CreateIndex
CREATE INDEX "outlet_franchisor_id_idx" ON "outlet"("franchisor_id");

-- CreateIndex
CREATE INDEX "candidate_site_pipeline_run_id_idx" ON "candidate_site"("pipeline_run_id");

-- CreateIndex
CREATE INDEX "poi_category_idx" ON "poi"("category");

-- CreateIndex
CREATE UNIQUE INDEX "poi_osm_id_key" ON "poi"("osm_id");

-- CreateIndex
CREATE INDEX "zonal_value_region_city_municipality_idx" ON "zonal_value"("region", "city_municipality");

-- CreateIndex
CREATE UNIQUE INDEX "zonal_value_region_city_municipality_rdo_classification_cod_key" ON "zonal_value"("region", "city_municipality", "rdo", "classification_code");

-- CreateIndex
CREATE INDEX "lease_comp_format_corridor_idx" ON "lease_comp"("format", "corridor");

-- CreateIndex
CREATE INDEX "lease_comp_mall_name_idx" ON "lease_comp"("mall_name");

-- CreateIndex
CREATE INDEX "mall_property_tier_idx" ON "mall_property"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "demographic_cell_psgc_code_key" ON "demographic_cell"("psgc_code");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_run_intake_submission_id_key" ON "pipeline_run"("intake_submission_id");

-- CreateIndex
CREATE INDEX "pipeline_run_franchisor_id_idx" ON "pipeline_run"("franchisor_id");

-- CreateIndex
CREATE INDEX "pipeline_run_status_idx" ON "pipeline_run"("status");

-- CreateIndex
CREATE INDEX "module_result_module_idx" ON "module_result"("module");

-- CreateIndex
CREATE UNIQUE INDEX "module_result_candidate_site_id_module_key" ON "module_result"("candidate_site_id", "module");

-- CreateIndex
CREATE UNIQUE INDEX "report_pipeline_run_id_key" ON "report"("pipeline_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "doc_chunk_source_table_source_id_chunk_index_key" ON "doc_chunk"("source_table", "source_id", "chunk_index");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE INDEX "audit_log_entity_entity_id_idx" ON "audit_log"("entity", "entity_id");

-- AddForeignKey
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_franchisor_id_fkey" FOREIGN KEY ("franchisor_id") REFERENCES "franchisor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outlet" ADD CONSTRAINT "outlet_franchisor_id_fkey" FOREIGN KEY ("franchisor_id") REFERENCES "franchisor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_site" ADD CONSTRAINT "candidate_site_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_intake_submission_id_fkey" FOREIGN KEY ("intake_submission_id") REFERENCES "intake_submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_run" ADD CONSTRAINT "pipeline_run_franchisor_id_fkey" FOREIGN KEY ("franchisor_id") REFERENCES "franchisor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_result" ADD CONSTRAINT "module_result_candidate_site_id_fkey" FOREIGN KEY ("candidate_site_id") REFERENCES "candidate_site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "module_result" ADD CONSTRAINT "module_result_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generation" ADD CONSTRAINT "ai_generation_pipeline_run_id_fkey" FOREIGN KEY ("pipeline_run_id") REFERENCES "pipeline_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_franchisor_id_fkey" FOREIGN KEY ("franchisor_id") REFERENCES "franchisor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- BSA custom DDL — geo/vector/text indexes and geom-population triggers.
-- Prisma cannot express these (Unsupported columns), so they live here and are
-- applied as part of the same migration. Portable to neon.tech unchanged.
-- ============================================================================

-- --- geom auto-population from lat/lon ---------------------------------------
-- Keeps geom in sync so radius/overlap queries are always indexed and correct,
-- regardless of whether a write goes through Prisma or a raw loader.
CREATE OR REPLACE FUNCTION bsa_set_geom_point() RETURNS trigger AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lon IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.lon, NEW.lat), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER outlet_geom_biu
  BEFORE INSERT OR UPDATE OF lat, lon ON "outlet"
  FOR EACH ROW EXECUTE FUNCTION bsa_set_geom_point();

CREATE TRIGGER candidate_site_geom_biu
  BEFORE INSERT OR UPDATE OF lat, lon ON "candidate_site"
  FOR EACH ROW EXECUTE FUNCTION bsa_set_geom_point();

CREATE TRIGGER poi_geom_biu
  BEFORE INSERT OR UPDATE OF lat, lon ON "poi"
  FOR EACH ROW EXECUTE FUNCTION bsa_set_geom_point();

CREATE TRIGGER mall_property_geom_biu
  BEFORE INSERT OR UPDATE OF lat, lon ON "mall_property"
  FOR EACH ROW EXECUTE FUNCTION bsa_set_geom_point();

-- --- GiST geo indexes (radius / overlap queries) ----------------------------
CREATE INDEX outlet_geom_gist          ON "outlet"          USING GIST ("geom");
CREATE INDEX candidate_site_geom_gist  ON "candidate_site"  USING GIST ("geom");
CREATE INDEX poi_geom_gist             ON "poi"             USING GIST ("geom");
CREATE INDEX mall_property_geom_gist   ON "mall_property"   USING GIST ("geom");
CREATE INDEX demographic_cell_geom_gist ON "demographic_cell" USING GIST ("geom");

-- --- POI name trigram search ------------------------------------------------
CREATE INDEX poi_name_trgm ON "poi" USING GIN ("name" gin_trgm_ops);

-- --- doc_chunk: HNSW vector + GIN keyword (retrieve-then-generate) ----------
-- tsv is maintained by trigger from content; HNSW enables fast semantic search.
CREATE OR REPLACE FUNCTION bsa_set_doc_tsv() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('english', COALESCE(NEW.content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER doc_chunk_tsv_biu
  BEFORE INSERT OR UPDATE OF content ON "doc_chunk"
  FOR EACH ROW EXECUTE FUNCTION bsa_set_doc_tsv();

CREATE INDEX doc_chunk_tsv_gin ON "doc_chunk" USING GIN ("tsv");
CREATE INDEX doc_chunk_embedding_hnsw ON "doc_chunk" USING hnsw ("embedding" vector_cosine_ops);
