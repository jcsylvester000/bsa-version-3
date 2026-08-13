# BSA API Reference

API-first: the browser speaks only to these routes. No secret reaches the client; no
component touches Postgres directly. Every request is Zod-validated at the boundary and
every response uses one envelope.

## Response envelope

```jsonc
// success
{ "ok": true, "data": { ... } }
// failure
{ "ok": false, "error": { "code": "string", "message": "string",
                          "details"?: [{ "path": "field", "message": "why" }] } }
```

Common error codes: `validation_error` (422), `completeness_gate` (422),
`unauthorized` (401), `forbidden` (403), `invalid_credentials` (401),
`not_found` (404), `server_error` (500).

Auth is a signed `bsa_session` httpOnly cookie (JWT, HS256, 8h). Send it with every
request; it is set on login and cleared on logout.

---

## POST /api/auth/login
Body: `{ email, password }`. On success sets the session cookie and returns
`{ user: { id, email, role, franchisorId } }`. Wrong credentials → `401 invalid_credentials`
(uniform — no user enumeration).

## POST /api/auth/logout
Clears the session cookie. Returns `{ loggedOut: true }`.

---

## GET /api/runs
Auth required. Lists pipeline runs the session can see — Grid staff see all; franchisor/
broker see only their own franchisor's runs (scoped in the query, not just the UI).
Returns `{ runs: [{ id, brandName, vertical, status, confidence, exclusivityRadiusM,
siteCount, createdAt }] }`.

---

## POST /api/intake
Auth required; caller must have access to `franchisorId`.
Body:
```jsonc
{
  "franchisorId": "uuid",
  "vertical": "fnb_cafe",           // one of the 18 verticals
  "sections": { "a": "...", ... },  // A–K; must-have set gates at 80%
  "outlets": [{ "outletName","format?","lat","lon","monthlySalesPhp?","performanceTag?" }],
  "candidateSites": [{ "label","address?","barangay?","city?","lat","lon","siteType?" }]
}
```
Validates (Zod + PH lat/lon bounds), enforces the **80% completeness gate**
(`422 completeness_gate` with the missing sections listed), then writes
`intake_submission` + `outlet` rows + `candidate_site` rows and creates a queued
`pipeline_run`. `geom` is computed by trigger. Returns
`{ intakeId, runId, completenessPct }` (201). Writes are sequential (Neon-HTTP safe).

---

## POST /api/territory-guard
Auth required (`admin/analyst/franchisor/broker`); caller must have access to the run's
franchisor. Body: `{ runId: uuid, exclusivityRadiusM?: 100–20000 }`.

For every candidate site in the run it: finds outlets within the search window using the
GiST geo index, computes trade-area overlap per outlet (**Verified**), estimates
cannibalization (**Projected**), writes a `module_result` (module=`territory`), and calls
the retrieve-then-generate layer to phrase a verdict from the grounded facts (logged to
`ai_generation`).

Returns `{ runId, exclusivityRadiusM, results: [ {
  candidateSiteId, site:{id,label}, candidateLat, candidateLon, candidateCatchmentM,
  maxOverlapPct, meanOverlapPct, totalCannibalizedPhp,
  verdict: "adds"|"mixed"|"redistributes",
  affectedOutlets: [{ outletName, distanceM, overlapPct, cannibalizedPhp }],
  truth: { overlapPct:"verified", cannibalizedPhp:"projected" },
  moduleTruthLayer, flags, verdictText } ] }`.

## GET /api/territory-guard?runId=uuid
Auth + access-scoped. Reads stored `module_result` (territory) rows for the dashboard:
`{ runId, exclusivityRadiusM, results: [{ site, score, truthLayer, flags, payload }] }`.

---

## POST /api/lease-benchmark
Auth required (`admin/analyst/franchisor/broker`); access-scoped to the candidate
site's run franchisor. Body:
```jsonc
{
  "candidateSiteId": "uuid",
  "corridor": "BGC",
  "format": "inline",
  "mallName"?: "SM Aura",
  "siteTerms": {           // at least one term required
    "baseRentPhpSqm"?, "escalationPct"?, "cusaPhpSqm"?,
    "leaseTermYears"?, "fitoutMonths"?
  }
}
```
Queries `lease_comp` for the format+corridor(+mall), benchmarks each term against the
comp distribution, writes `module_result(module="lease")`, and phrases a verdict via
retrieve-then-generate. Returns `{ baseRentPercentile, baseRentStats{n,min,p25,median,
p75,max}, terms[{term,label,value,stats,percentile,flag}], sampleSize, lowSample,
negotiatingRoomPhpSqm, negotiatingRoomPct, verdict: "below_market"|"at_market"|
"above_market"|"insufficient_data", comps[], truth{comps:"verified",fairRange:"assumed"},
flags, site, verdictText }`.

**Honesty:** with fewer than 5 comps the verdict is `insufficient_data`, `lowSample` is
true, and the fair-range Truth Layer drops to `projected` — it never fabricates a
benchmark. `over`/`under`/`at` flags are relative to the corridor median (±5% band).

## GET /api/lease-benchmark?candidateSiteId=uuid
Auth + access-scoped. Reads the stored lease `module_result`:
`{ site, truthLayer, flags, payload }`.

---

## POST /api/reports
Auth required (`admin/analyst/franchisor/broker`); access-scoped to the run's franchisor.
Body: `{ runId: uuid }`. Composes the 9-section Site Intelligence Report from the run's
`module_result` rows via retrieve-then-generate, computes run confidence from the Truth
Layer mix, renders Markdown, stores it behind a signed URL, and saves/updates the `report`
row. Returns `{ reportId, runId, confidence, truthLayerMix{verified,assumed,projected},
sections[{number,title,text,truthLayers,assessed}], downloadUrl }`.

Sections with no supporting module data are returned with `assessed:false` and a
"not assessed" note — never invented. Numbers come only from the module results; the AI
phrases and preserves every Truth Layer label.

## GET /api/reports?runId=uuid
Auth + access-scoped. Returns the stored report metadata and a fresh signed download URL:
`{ reportId, confidence, generatedAt, downloadUrl }`.

## GET /api/files?key=...&exp=...&sig=...[&dl=1]
Serves a stored object ONLY with a valid, unexpired HMAC-signed token (the local-fs
equivalent of a presigned bucket URL). No public listing. Invalid/expired/missing token →
uniform `404` (does not distinguish the reason). `dl=1` sets a download disposition.

---

## POST /api/runs/[id]/run
Auth + access-scoped. Executes the deterministic pipeline for a run: runs the modules
the vertical activates (site_fit + territory + lease always; daypart/informal/mall/
healthcare/whitespace per vertical) across all candidate sites, writes `module_result`
rows, updates each candidate's composite score + verdict, and sets run status
(`analyzing`→`ready`/`failed`) and confidence from the Truth Layer mix. Idempotent
(module_results upsert). Returns `{ runId, status, confidence, modulesRun[], siteCount,
perSite[{siteId,label,composite,verdict}] }`.

## GET /api/modules?runId=uuid
Auth + access-scoped. All `module_result` rows for a run, for the modules overview:
`{ runId, status, confidence, results[{module, site, score, truthLayer, flags, payload}] }`.

## Reference-data ingestion (CLI, not HTTP)
`npm run db:ingest [poi|zonal|demographics]` — idempotent ETL into the reference tables
via `lib/ingest/loaders.ts`. Validates (PH-bounds, required fields), classifies Truth
Layer at the data layer, dedups on the natural key (osm_id / region+city+rdo+classification
/ psgc_code). Sample datasets in `prisma/data/`.

## Mock mode (no database)
When `AUTH_MODE=mock` (or no `DATABASE_URL`), login, Territory Guard, and Lease Benchmark
compute against in-memory demo data using the same pure math as the DB path — the whole
app is clickable with no Postgres. The demo run id is `mock-run-...`; demo site ids are
`mock-s1`/`mock-s2`. Request schemas accept these mock ids alongside real UUIDs.

---

## POST /api/geocode
Auth required. Body `{ address }`. Turns a typed address into real PH lat/lon via
Google Geocoding (server-side key). Returns `{ lat, lon, formattedAddress, types }`.
Used by intake so users type an address, not coordinates.

## POST /api/places
Auth required. Pulls REAL establishments from Google Places (server-side key), cached
by area+type to limit re-billing.
- `{ mode:"nearby", lat, lon, vertical?|types?, radiusM?, max? }` — competitors/POIs of
  a vertical's category around a point.
- `{ mode:"text", query, max? }` — a named brand/category's outlets across the PH.
Returns `{ places:[{name,lat,lon,address,primaryType}], label }`.
Feeds Territory Guard's competition read and the Explore page. Falls back to empty when
GOOGLE_API_KEY is unset.

## GET /api/maptiles  and  GET /api/maptiles/[z]/[x]/[y]
Mint a Google Map Tiles session and proxy tiles server-side so the basemap is Google
Maps without exposing the key (see the map section).

---

## Contract rules the dev team should preserve

- Truth Layer is **part of the contract** — every data-bearing value carries its
  classification. Do not strip it in a new endpoint.
- Business logic lives in `lib/`; routes stay thin (validate → call lib → shape).
- The long pipeline run is designed to kick off server-side and expose status via the run
  record rather than blocking the request. Territory Guard is fast enough to run inline
  today; heavier modules should follow the queued pattern (`pipeline_run.status`).
