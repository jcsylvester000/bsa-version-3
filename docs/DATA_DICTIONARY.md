# BSA Data Dictionary

Sixteen PostgreSQL tables (Prisma models) in five groups. Every reference and result
row carries a `truth_layer` classification (Verified / Assumed / Projected) at the data
layer — never a display-only flag. Geo columns (`geom`) are PostGIS
`geography(4326)` computed from lat/lon by trigger; `embedding` is pgvector `vector(1536)`.

Truth Layer is enforced structurally: it is assigned at ingestion and preserved through
every read, and it travels with the data into any AI context.

## Group 1 — Core domain

### franchisor
The brand/company that owns the intake. One row per client. *Truth Layer: n/a (factual record).*
Key columns: `id` (uuid pk), `brand_name`, `legal_name`, `sector` (FnB/Retail/Services),
`sub_category`, `positioning`, `created_at`. Index: `btree(sector, sub_category)`.

### intake_submission
One completed intake per run — the A–K checklist as typed JSONB sections, not stringified
cells. *Truth Layer: field-level via section JSONB.*
Key columns: `id`, `franchisor_id` (fk), `vertical` (enum), `completeness_pct`,
`section_a … section_k` (jsonb), `status` (draft/validated/submitted), `submitted_at`.
Indexes: `fk(franchisor_id)`, `btree(status)`.

### outlet
The franchisor's existing branches (intake Section G). Powers calibration **and** Territory
Guard cannibalization math. *Truth Layer: sales/perf = Assumed unless franchisor-verified.*
Key columns: `id`, `franchisor_id` (fk), `outlet_name`, `format`, `status`,
`lat`, `lon`, `geom` (geography point, trigger-computed), `floor_area_sqm`,
`monthly_sales_php`, `avg_ticket_php`, `monthly_rent_php`, `performance_tag`,
`opening_date`, `truth_layer`. Indexes: `fk`, `GiST(geom)`.

### candidate_site
A location evaluated in a run. *Truth Layer: geom Verified, scores Projected.*
Key columns: `id`, `pipeline_run_id` (fk), `label`, `address`, `barangay`, `city`,
`lat`, `lon`, `geom`, `site_type`, `composite_score`, `verdict` (go/caution/nogo).
Indexes: `fk`, `GiST(geom)`.

## Group 2 — Reference data (all carry a Truth Layer column)

### poi
Points of interest — competitors, anchors, footfall proxies, healthcare. From OSM Overpass.
*Truth Layer: coord Verified, barangay Assumed.*
Key columns: `id` (bigint pk), `name`, `category` (enum), `lat/lon`, `geom`, `city`,
`barangay`, `source` (osm/manual), `truth_layer`, `osm_id` (unique — idempotent upsert).
Indexes: `GiST(geom)`, `btree(category)`, `GIN(name gin_trgm_ops)`.

### zonal_value
BIR RDO zonal schedules — **tax-reference floors ONLY, never market-price proxies.**
*Truth Layer: Verified/Assumed per source completeness.*
Natural key: `(region, city_municipality, rdo, classification_code)`.
Key columns: `low_php_sqm`, `high_php_sqm`, `notes`. Index: `btree(region, city_municipality)`.

### lease_comp
NEW — the Lease Benchmark dataset. Observed lease terms by format, corridor, mall. Seeded
from ARIA + brokers, grows per run. *Truth Layer: Verified comps vs Assumed estimates.*
Key columns: `format`, `corridor`, `mall_name`, `base_rent_php_sqm`, `escalation_pct`,
`cusa_php_sqm`, `lease_term_years`, `fitout_months`, `observed_date`, `sample_source`.
Indexes: `btree(format, corridor)`, `btree(mall_name)`.

### mall_property
NEW — Mall Intelligence. Tier, footfall band, rent/CUSA norms, co-tenancy. *Truth Layer:
tier Verified, footfall Assumed.* Key columns: `mall_name`, `city`, `tier` (A/B/C),
`footfall_band`, `rent_band_php_sqm`, `cusa_band`, `geom`. Indexes: `GiST(geom)`, `btree(tier)`.

### demographic_cell
PSA demographics by barangay/grid cell — population, income, age, tenure, daytime pop. Powers
catchment scoring, Daypart, White-Space. *Truth Layer: PSA Verified, projections Assumed.*
Natural key: `psgc_code`. `geom` is a polygon for containment joins. Index: `GiST(geom)`.

## Group 3 — Run / Output

### pipeline_run
One BSL analysis run; tracks state through the phases. *Truth Layer: run-level confidence =
Truth Layer mix.* Key columns: `id`, `intake_submission_id` (fk, unique), `franchisor_id`,
`vertical`, `status` (queued/researching/analyzing/composing/ready/failed), `confidence`,
`exclusivity_radius_m`, `started_at`, `finished_at`. Indexes: `fk`, `btree(status)`.

### module_result
One result per (site × module). **How new features plug in without schema churn** — each
module writes a typed row. *Truth Layer: row-level per module output.*
Key columns: `candidate_site_id` (fk), `pipeline_run_id` (fk), `module`
(site_fit/financial/risk/calibration/**territory**/lease/daypart/whitespace/mall/healthcare/informal),
`score`, `payload` (jsonb), `truth_layer`, `flags` (text[]).
Unique: `(candidate_site_id, module)` — idempotent per site×module. Index: `btree(module)`.

### report
The generated Site Intelligence Report (9 sections). Stores pointer + metadata, not the blob.
*Truth Layer: inherits run confidence.* Key columns: `pipeline_run_id` (fk, unique),
`storage_key`, `format` (pdf/docx), `confidence`, `generated_at`.

## Group 4 — AI / Search

### doc_chunk
Retrieve-then-generate substrate. Chunked reference text with `embedding` (vector 1536) +
`tsv` (tsvector) for hybrid semantic+keyword lookup. *Truth Layer carried into AI context.*
Natural key: `(source_table, source_id, chunk_index)`. Indexes: `HNSW(embedding vector_cosine_ops)`,
`GIN(tsv)`. `tsv` maintained by trigger from `content`.

### ai_generation
Audit trail of every AI call — the retrieved chunk ids, prompt purpose, model, tokens, output.
Makes any generated sentence traceable. Key columns: `pipeline_run_id` (fk), `purpose`
(verdict/summary/section), `retrieved_chunk_ids` (bigint[]), `model`, `input_tokens`,
`output_tokens`, `output`, `created_at`.

## Group 5 — Ops / Governance

### app_user
Grid staff / broker / franchisor accounts. Role-based access. Key columns: `email` (citext
unique), `password_hash` (bcrypt), `role` (admin/analyst/broker/franchisor),
`franchisor_id` (fk nullable — scopes what the session can read).

### audit_log
Who did what, when — governance requirement (intake Section K). Key columns: `actor_id` (fk),
`action`, `entity`, `entity_id`, `at`, `meta` (jsonb). Index: `btree(entity, entity_id)`.

## Notes for the dev team

- The `geom` triggers (`bsa_set_geom_point`) and the `doc_chunk` `tsv` trigger live in the
  init migration's custom-DDL block, portable to neon.tech unchanged.
- Under the Neon HTTP adapter, nested writes split into sequential calls — data-access code
  avoids deep nested creates (see the intake route).
- Ingestion upserts on natural keys (`osm_id`, `psgc_code`, `(rdo+classification)`) so
  re-runs never duplicate.
