# Admin POI Capture — Plan (from the grid-navigator review)

_Status: **BUILT 2026-10-07** (phases A–D, awaiting push). Owner decisions in §9. Implementation notes in §11._
_Date: 2026-10-07 · Skills consulted: 12 (plan), 02 (data), 03 (API), 04 (security), 01 (UI), 07 (domain), 11 (tests)._
_Source reviewed (read-only): `2 -  Data Intake/grid-navigator/grid-navigator` (Next 14 + Leaflet + Zustand + IndexedDB)._

---

## 1. Objective

Give Grid admins a map screen inside BSA where they pick any area of the Philippines, capture the
points of interest (POIs) in it, review them, and save them into the shared `poi` table — so BSA can
expand beyond NCR / Davao / Cavite / Batangas, with every row correctly geo-tagged and Truth-Layer classified.

## 2. What grid-navigator actually does (POI capture)

| Piece | File | Behaviour |
|---|---|---|
| Whitelist | `src/lib/geo.ts` `POI_TAGS` | 23 OSM `key=value` tags → 7 navigation buckets (emergency, health, fuel, finance, civic, transit, essentials). |
| Query | `buildOverpassQuery` | `node` + `way` per tag inside the map's bbox; `out center tags`. |
| Fetch | `fetchPoisForBbox` | **Browser** POSTs to public Overpass, classifies, de-dupes on `"node/123"`-style ids. |
| City tag | `reverseGeocodeCity` + `tileCache.cacheView` | **Browser** calls Nominatim for the map **centre**, then stamps that one city on every POI in the view. |
| Store | `savePois` → IndexedDB `pois` | Local to one browser. |
| Manual capture | `Checkpoint` (name, notes, colour, lat, lng) | Click-to-pin with a modal. |
| Areas | `Shape` rect / circle | Drawn on the map; rect = two corners, circle = centre + radius (m). |
| Transport | `.gridnav.json` save file | `{format:'grid-navigator-save', version, checkpoints[], routes[], shapes[], pois[], tiles?}`. |

It is a good **field tool and UX pattern**, not a data pipeline: everything lives in the browser, the
city tag is wrong for any view that crosses an LGU boundary, unnamed POIs get the category label as
their name ("Health"), and imports are not validated.

## 3. What BSA already has (do not rebuild)

- `poi` table with `geom`, `city/barangay/region/province`, `source` (osm|google|manual), `provenance`,
  `truth_layer`, unique `osm_id`.
- Server-side Overpass client `lib/places/osmService.ts` (endpoint rotation, retries, tiled sweeps,
  BSA vertical tag sets, transport layer) and `osmTagToPoiCategory`.
- Bulk loaders: `prisma/ingestOsm.ts` (region sweeps, resumable), `prisma/pushRegion.ts` (Docker → Neon),
  `lib/ingest/loaders.ts` `loadPoi` (batched `ON CONFLICT (osm_id)`).
- `/api/admin/warm` (admin-only, lat/lon radius, NCR grid) and `/api/admin/data-stats` (staff).
- `admin_boundary` (PSGC polygons) + `resolveAdminBoundary(lat, lon)` → barangay / city / province / region.
- Region registry `lib/geo/regions.ts` (4 regions: scoring config — corridors, zonal, warm centres).

**Conclusion:** BSA already captures OSM POIs better than the navigator does on the server side. What it
lacks is the **admin-facing loop**: pick any area on a map → preview → review/edit → commit → see coverage,
plus **manual pins** and **import of field files**. That is what we take from grid-navigator.

## 4. Reuse vs. leave behind

**Reuse (refactor into `4 - Final Application`, never copy the original):**
- The capture loop UX: draw rectangle / circle → "Capture this area" → progress → result count.
- The checkpoint modal fields (name, notes) → becomes the "Add place manually" form.
- The `type/id` element key (`node/123`) — it is more correct than BSA's current key (see §5).
- The navigation whitelist as an extra **"Civic & everyday anchors"** layer next to BSA's vertical layers.
- The `.gridnav.json` format as an import source for field agents (POIs + checkpoints only).

**Leave behind:**
- Browser calls to Overpass / Nominatim (breaks API-first, the nonce CSP, and the services' usage policies).
- IndexedDB as storage, offline tile caching (bulk OSM tile download is against the tile policy; admins are online).
- Leaflet — BSA standardises on MapLibre (`LocationPicker`, `TerritoryMap`, `/api/maptiles`). One map library.
- Centre-of-view city stamping — replaced by per-point PSGC lookup.
- Category-label names for unnamed places.

## 5. Bug found in the current BSA build (fix in Phase A)

`osmService` queries both `node` and `way`, but `poi.osm_id` stores only the numeric id. OSM numbers nodes
and ways independently, so node 123 and way 123 share `osm_id = 123`; `loadPoi`'s `ON CONFLICT (osm_id) DO
UPDATE` then **overwrites one place with another** (name, category, coordinates). Rare per area, but it grows
with every region we add. Fix: add `osm_type` and make `(osm_type, osm_id)` the natural key. Existing rows get
`osm_type = NULL`; re-running a region's ingest fills it in.

## 6. Conversion spec — navigator / OSM → `poi`

| Source field | `poi` column | Rule |
|---|---|---|
| `id` `"node/123"` / Overpass `type,id` | `osm_type`, `osm_id` | split; reject anything not `node|way|relation/<digits>` |
| `name` / `tags.name` / `name:en` | `name` | trim, ≤ 200 chars. **Unnamed:** keep only transport stops (label "Unnamed bus stop", as BSA already does); otherwise drop — never invent a name |
| `kind` / matched tag | `kind` (new) | keep the original tag, e.g. `amenity=pharmacy` |
| `category` | `category` | map via the table below (BSA categories drive scoring) |
| `lat`, `lng` / `lon` | `lat`, `lon`, `geom` | PH bounds check (lat 4–21, lon 116–127); `geom = ST_SetSRID(ST_MakePoint(lon,lat),4326)::geography` |
| `city` (navigator) | — | **discarded**; recomputed per point |
| — | `barangay`, `city`, `province`, `psgc_code` (new) | `resolveAdminBoundary(lat, lon)`; null if boundaries not loaded |
| — | `region` | registry key if `regionForPoint` matches, else the PSA region from the boundary (e.g. `psa:07`) |
| — | `source` / `provenance` | `osm` / `osm:admin-capture:<batchId>`; imports `osm:navigator-import:<batchId>` |
| — | `truth_layer` | live OSM pull **Verified** (same as existing ingest); a Grid Navigator file is client-supplied, so its POIs import as **Assumed** and never overwrite a stored place — re-capturing the area from OSM refreshes them to Verified |
| Checkpoint `name`, `notes`, `lat`, `lng` | `name`, `lat`, `lon` (+ notes kept on the staging row) | `source = manual`, **Assumed**; admin must choose the category at review |
| Checkpoint `id`, `color`; routes; tiles | — | discarded (rect/circle shapes may be reused as capture areas) |

**Category map — revised during the build.** The first draft filed pharmacies, supermarkets, banks and fuel
as `anchor`. That would have broken Territory Guard: the CLI sweep already stores those as `competitor`
(each is a BSA franchise vertical, and `competitorsNear` reads `category = 'competitor'`), so a re-capture
would have flipped existing rows out of the competitor set. The build therefore uses ONE rule for every
write path — `lib/places/osmCategory.ts`:

- `osmTagToPoiCategory` (the original ingest rule, unchanged) for every business tag → pharmacy, supermarket,
  marketplace, fuel, bank, ATM, water station = `competitor`; school = `school`; hospital = `hospital`;
  clinic/doctors = `clinic`; laboratory = `diagnostic`; mall/department store = `mall`; stations = `transport`.
- `captureCategory` adds civic overrides so non-businesses are never competitors: place of worship,
  community centre, post office = `anchor`; town hall, courthouse, government office = `office`;
  police, fire station, drinking water = `other` (the old rule filed a fire *station* as transport);
  college/university/kindergarten = `school`; dentist, healthcare clinic/centre = `clinic`.

Competitor capture for a franchise vertical uses BSA's own vertical tag sets in `osmService`, not this table.

**De-duplication at review:** match on `(osm_type, osm_id)` first; for manual pins and unkeyed rows, flag a
possible duplicate when an existing POI with a similar name (trigram ≥ 0.6) lies within 50 m. The admin picks
keep / merge / skip — nothing merges silently.

## 7. Build plan (dependency order)

**Phase A — Data (Skill 02).** One migration:
- `poi`: add `osm_type`, `kind`, `psgc_code`, `capture_batch_id`, `verified_at`, `verified_by`; replace unique
  `osm_id` with unique `(osm_type, osm_id)`; update `loadPoi` / `poiCache` upserts to the new key.
- `poi_capture_batch`: id, created_by, label, `area geography(Polygon)`, source (`osm|navigator_import|manual`),
  layers[], status (`draft|committed|discarded`), counts, created_at, committed_at. GiST on `area`.
- `poi_capture_item`: batch_id, mapped fields, raw JSON (bounded), decision (`pending|accept|reject|duplicate`),
  match_poi_id, notes.
- Pure helpers + tests: `lib/capture/categoryMap.ts`, `lib/capture/osmKey.ts`, `lib/capture/navigatorFile.ts` (zod).

**Phase B — API (Skills 03 + 04).** All under `/api/admin/capture`, **admin role only**, zod-validated, standard `ok/fail` envelope:
- `POST /preview` — `{ area: rect|circle|polygon, layers[] }` → server Overpass via `osmService` (tiled), area cap
  ≈ 25 km² per call, `maxDuration` 60, returns a draft batch with mapped + de-duped items.
- `POST /import` — `.gridnav.json` ≤ 10 MB; `tiles` ignored; POIs and checkpoints become a draft batch.
- `POST /manual` — one pin `{ lat, lon, name, category, notes? }` → draft item.
- `GET /batches`, `GET /batches/:id`, `PATCH /batches/:id/items` (accept / reject / edit name or category).
- `POST /batches/:id/commit` — writes accepted items to `poi` (sequential batched upserts), PSGC-tags each point,
  writes `audit_log` (`poi.capture.commit`, counts), marks the batch committed. Idempotent on re-commit.
- `GET /coverage` — GeoJSON of committed areas + POI counts per city for the coverage layer.
- `PATCH /pois/:id/verify` — field-confirmed manual pin → Verified (`verified_at/by`, audited).

**Phase C — UI (Skills 01 + 07).** `/admin/capture`, plus an **Admin** nav group shown only to admins:
MapLibre map (reuse the `LocationPicker` setup and `/api/maptiles`), place search through the existing
`/api/geocode` when geocoding is enabled (else pan/zoom + lat/lon entry), tools *Rectangle · Circle · Pin*, layer checklist (Anchors, Transport, Health, Education,
Offices, Competitors by vertical), preview markers + review table (Truth chip, duplicate flag, accept/reject),
Commit, coverage overlay, batch history. Design v2 tokens and components.

**Phase D — Verify + document (Skills 11, 08, 09).** Unit tests (mapping, key split, file schema, de-dupe),
route tests (401 / 403 for non-admins, validation, area cap), journey QA (capture → commit → a new intake in the
new area finds those POIs), updates to `DATA_DICTIONARY.md`, `API_REFERENCE.md`, `OWNER_RUNBOOK.md`.

**Province-scale loads stay on the CLI** (`db:ingest:osm` → `db:push-region`). The admin screen is for targeted
areas, gap-filling and field data — not sweeping a whole province through public Overpass from a web request.

## 8. Expanding to a new region — the order that works

1. Load boundaries for the region (`db:fetch-boundaries`) → PSGC tagging works.
2. Capture or ingest POIs (this feature, or the CLI for whole provinces).
3. Load demographics, zonal, lease comps, malls, traffic via the existing R-series loaders.
4. Add a registry entry in `lib/geo/regions.ts` (corridors, city canonicalisers) when lease/zonal data exists.
   Until then, sites there run with honest gaps (missing → "—", Low confidence), never invented values.

## 9. Owner decisions (answered 2026-10-07)

1. **Field capture:** grid-navigator stays the separate offline field tool; BSA imports its session files.
   Its capture loop is blended into BSA itself (Admin → Place Capture), pushed to the BSA repo.
2. **Expansion regions:** Cavite (already registered), **Laguna** and **Pampanga** (added to the registry).
3. **Who commits:** admins only (the API refuses analysts/brokers with 403; the menu item is admin-only).
4. Earlier migrations and pushes: confirmed applied by the owner.

## 10. Security notes (Skill 04)

Admin-only at the API boundary (not just hidden UI); all outbound OSM calls server-side with existing retry and
polite delays; area cap + per-admin rate limit on `/preview`; uploads size-capped, JSON-schema validated, tiles
never stored; no raw client SQL (parameterised `Prisma.sql` only); every commit and verify audit-logged;
no new secrets.

## 11. What was built (2026-10-07)

| Layer | Files |
|---|---|
| Data | migration `20261007000000_admin_poi_capture`; `poi.osm_type/kind/psgc_code/capture_batch_id/verified_*`; `poi_capture_batch`, `poi_capture_item`; `lib/ingest/poiKeySql.ts` (legacy claim); loaders, on-demand cache, `pushRegion`, `ingestOsm` on the `(osm_type, osm_id)` key; `tagByBoundary` lets polygons win the POI region |
| Regions | `lib/geo/regions.ts`: `laguna`, `pampanga` (+ Angeles City via `psgcExtraCities`, Laguna `pointBoxes`), `regionForProvinceName`; `fetchBoundaries` loads independent cities; npm scripts |
| Pure capture | `lib/places/osmCategory.ts`, `lib/capture/{area,layers,candidate,mapElement,navigatorFile}.ts` |
| Service | `lib/services/capture.ts` (preview, import, manual, review, commit, discard, coverage, verify) |
| API | `lib/api/adminCapture.ts`, `app/api/admin/capture/**` (11 handlers) |
| UI | `app/(app)/admin/capture/page.tsx`, `components/admin/CaptureWorkbench.tsx`, admin nav group |
| Tests | `adminCapture.test.ts`, `adminCaptureRoutes.test.ts`, regions/pushRegion/batchLoaders updates |
