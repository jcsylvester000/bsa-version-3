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
`sub_category`, `positioning`, `requirements` (jsonb template), `created_by_user_id` (uuid,
nullable — **brand privacy**: NULL = shared seeded catalog; set = private to that user + staff),
`created_at`. Indexes: `btree(sector, sub_category)`, `btree(created_by_user_id)`.

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
`opening_date`, `truth_layer`, `intake_submission_id` (fk nullable — NULL = the brand's
reference network; set = typed into that intake and visible ONLY to that run).
Indexes: `fk`, `GiST(geom)`, `btree(intake_submission_id)`.

### candidate_site
A location evaluated in a run. *Truth Layer: geom Verified, scores Projected.*
Key columns: `id`, `pipeline_run_id` (fk), `label`, `address`, `barangay`, `city`,
`lat`, `lon`, `geom`, `site_type`, `composite_score`, `verdict` (go/caution/nogo),
`analyzed_at` (set when the pipeline finished the site — resume key), `pipeline_error`
(modules that failed on the last pass; NULL = clean). Indexes: `fk`, `GiST(geom)`.

## Group 2 — Reference data (all carry a Truth Layer column)

### poi
Points of interest — competitors, anchors, footfall proxies, healthcare. From OSM Overpass.
*Truth Layer: coord Verified, barangay Assumed.*
Key columns: `id` (bigint pk), `name`, `category` (enum), `lat/lon`, `geom`, `city`,
`barangay`, `province`, `region`, `psgc_code`, `source` (osm/google/manual), `provenance`, `truth_layer`,
`osm_type` + `osm_id` (natural key, unique together — idempotent upsert), `kind` (matched OSM tag, e.g.
`amenity=pharmacy`), `capture_batch_id` (admin capture batch that last wrote the row), `verified_at` /
`verified_by` (field confirmation of a manual pin).
**OSM key (2026-10-07):** nodes and ways are numbered independently, so the key is `(osm_type, osm_id)`.
Rows loaded before that have `osm_type` NULL and stay unique on `osm_id` via the partial index
`poi_osm_legacy_key`; the next ingest of the same element (same id, within 150 m) claims them.
Indexes: `GiST(geom)`, `btree(category)`, `btree(region)`, `GIN(name gin_trgm_ops)`, unique
`(osm_type, osm_id)`, unique partial `osm_id WHERE osm_type IS NULL`.

### poi_capture_batch  _(admin Place Capture, 2026-10-07)_
One capture action — a live OSM area pull, a Grid Navigator session import, or manual pins — staged for
review. `id` (uuid), `label`, `source` (osm / navigator_import / manual), `area` (geography polygon; GiST),
`area_spec` (the area as drawn), `layers`, `status` (draft / committed / discarded), `item_count`,
`committed_count`, `notes` (reviewer warnings), `created_by`/`created_at`, `committed_by`/`committed_at`,
`fetched_layers` (2026-10-08: the layers this capture loaded **completely** and stamped as covered — a failed or
truncated layer is in `layers` but not here). Since v2 every batch is written `committed` at Save.

### location_demand  _(user demand, 2026-10-09)_
What users look for: `kind` (search / intake_site), `user_id`, `franchisor_id`, `query` (search text ≤ 200), `label`,
`lat/lon`, `cell_key` (~1.1 km), barangay/city/province/region at that point, `vertical`, `run_id`/`site_id` (intake),
`places_nearby` (poi within 1.5 km at that moment), `coverage_status` (covered / partial / gap), `fill_job_id`.
**Personal data (RA 10173):** admin-only view, no IP/device, purge after 12 months (`npm run db:purge-demand`).

### poi_fill_job  _(automated back-fill queue, 2026-10-09)_
One job per ~1 km area (`area_key` = `f:<lat 2dp>:<lon 2dp>`, one OPEN job per key — partial unique index): `label`,
`lat/lon`, `radius_m` (1,500; 1,000 in dense centres), `layers` / `layers_done` / `layers_failed`, `status`
(queued / running / done / partial / failed / cancelled), `reason` (intake / search / admin), `demand_count`, `run_ids`
(analyses waiting), `attempts` (≤ 3, back-off 20 → 40 min), `next_attempt_at`, `places_saved`, `last_error`. Places it
saves are ordinary capture batches ("Auto-fill · …"), Verified via OSM receipts; misses go to `poi_capture_gap`.

### pipeline_run — back-fill columns (2026-10-09)
`data_pending_at` (a site had little/no place data at intake), `data_refresh_state` (null | waiting | due | running |
done | unavailable), `data_refreshed_at` (recomputed automatically with the new data).

### poi_capture_gap  _(retry queue, 2026-10-08)_
One area + layer OpenStreetMap did not return completely. `area_key` (rounded area spec) + `layer` — one **open**
row per pair (partial unique index); repeats bump `attempts`/`last_attempt_at`. `label`, `area_spec`, `context`
(site pin + business types, so a retry restores the setup), `area` (geography polygon; GiST), `lat/lon` (centre),
`reason` (timeout / limit / error), `message`, `status` (open / resolved / dismissed), `created_by`, `created_at`,
`resolved_at`, `resolved_batch_id`. Logged by `/preview`; closed automatically when saved captures of that layer
from the last 90 days cover the area (union of rings counts), or dismissed by an admin. Bookkeeping only — never
place data, no Truth Layer.

### poi_capture_item
One staged place, already mapped to `poi` columns: `batch_id`, `osm_type`/`osm_id`, `name`, `kind`,
`category`, `lat/lon`, `source`, `truth_layer`, `decision` (pending / accept / reject),
`existing_poi_id` (same OSM element already stored), `duplicate_of_poi_id` (similar name within 50 m),
`notes`, `committed_poi_id`. Truth Layer: live OSM = Verified; Grid Navigator imports and manual pins =
Assumed (a manual pin becomes Verified only when an admin field-confirms it).

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
Natural key: `psgc_code`. `geom` is a MultiPolygon (R-04: the real barangay boundary from admin_boundary; legacy rows a 600 m circle) for catchment ST_DWithin. Index: `GiST(geom)`. Loaded via `db:load-demographics` (PSA census; population Verified).

### admin_boundary
Official PSA administrative boundaries (region → province → city → barangay), loaded from the
PSGC shapefiles (R-02, `prisma/loadBoundaries.ts`). Point-in-polygon over `geom` assigns every POI
and candidate site its real barangay/city/province + PSGC (`prisma/tagByBoundary.ts`; new sites at
intake time). *Truth Layer: Verified (official).* Key columns: `psgc_code` (pk, text — leading
zeros), `level` (region/province/city/barangay), `name`, `parent_psgc`, `region` (BSA region key),
`geom` (geography MultiPolygon). Indexes: `GiST(geom)`, `btree(level)`, `(region, level)`, `parent_psgc`.
Region/POI/site tagging columns: `poi.region/province/psgc_code`, `candidate_site.region/province/psgc_code`,
`mall_property.region/province/psgc_code` (region from lib/geo/regions; barangay/city/province/psgc from admin_boundary).

## Group 3 — Run / Output

### pipeline_run
One BSL analysis run; tracks state through the phases. *Truth Layer: run-level confidence =
evidence confidence (decision-weighted Truth Layers; see `lib/modules/scorecard.ts`).* Key columns: `id`, `intake_submission_id` (fk, unique), `franchisor_id`,
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
> **Deprecated (Sep 2026).** `ai_generation` and `pipeline_usage` backed the removed external
> VectorShift analysis. They are retained in the schema for historical rows and are **not written by
> any current code path** — the recommendation is deterministic (`siteVerdict.ts`). The dev team may
> drop them in a future migration once historical data is no longer needed.

Audit trail of every (historical) AI call — the retrieved chunk ids, prompt purpose, model, tokens,
output. Key columns: `pipeline_run_id` (fk), `purpose` (verdict/summary/section),
`retrieved_chunk_ids` (bigint[]), `model`, `input_tokens`, `output_tokens`, `output`, `created_at`.

### pipeline_usage  _(deprecated — see note above)_
One row per historical external-AI call — cost + reliability monitor. **No response text.** Key
columns: `user_id`, `franchisor_id`, `pipeline_run_id`, `candidate_site_id`, `provider`, `model`,
`vs_run_id`, `cost_raw`, `cost_value`, `status` (ok/error), `error_code`, `latency_ms`,
`trigger` (initial/regenerate), `created_at`.
Indexes: `user_id`, `franchisor_id`, `created_at`, `(candidate_site_id, created_at)`.

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
