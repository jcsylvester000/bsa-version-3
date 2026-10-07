# Owner runbook — the remaining non-code items

These four audit items need actions only the owner can take (credentials, licensed/downloaded data, or
running the loaders against the live database). The code side is done; this is the checklist to finish them.

---

## F-31 — Rotate the exposed credentials  (Security · **do this first**)

A Google API key was once committed in `keys.docx`, and real account passwords were in an old DB dump.
The repo history has been cleaned, but anything that was exposed must be rotated.

1. **Google API key** — in Google Cloud Console, create a **new** key, then delete the old one.
   Restrict the new key: by **API** (Places, Geocoding, Map Tiles only) and by **HTTP referrer / IP** to
   the Netlify domain. Put it in Netlify env as `GOOGLE_API_KEY` (never in the repo).
2. **Passwords** — reset any real account whose password was in the old dump (`/settings` → change
   password, or an admin reset). After F-26, a password change now revokes that user's other sessions
   automatically.
3. **Repo** — confirm the Git remote is **private** and that `keys.docx` / DB dumps are not tracked
   (`git ls-files | grep -iE 'keys|dump'` returns nothing).

## F-19 — Load Cavite & Batangas reference data  (Data · **High**)

Cavite and Batangas are wired in code (region registry, loaders, scoring) but have **no data loaded**.
Follow the one-province order (details in `docs/qa-history/QA_JOURNEY_FINDINGS_CALABARZON.md` and each
`prisma/data/*/README.md`). Set `DIRECT_URL` first (the bulk loaders prefer it). For each region
(`--region=cavite`, then `--region=batangas`):

```bash
npm run db:fetch-boundaries -- --region=cavite      # 1. admin boundaries (barangay polygons)
npm run db:ingest:osm:cavite                         # 2. competitors + brands (run in a quiet hour)
npm run db:ingest:osm:transport:cavite               # 2b. transport layer (F-15 accessibility)
npm run db:populate:ncr  # (NCR only) — for provinces use the region loaders below
# 3. PSA demographics, 4. BIR zonal, 5. lease comps, 6. malls, 7. traffic AADT:
#    load the province files documented in prisma/data/{demographics,zonal,lease,malls,traffic}/README.md
npm run db:enrich-age                                # age profiles (real PSA file if provided, else proxy)
```

Then run a Cavite and a Batangas intake end-to-end and confirm confidence is no longer defaulting to Low.
OSM/Overpass is rate-limited — the sweeps are resumable (`poi_coverage`), so re-run until clean.

### Laguna & Pampanga (registered 2026-10-07)

Same order with `--region=laguna` / `--region=pampanga` (scripts `db:ingest:osm:laguna`,
`db:ingest:osm:pampanga`, `db:ingest:osm:transport:laguna|pampanga`). `db:fetch-boundaries --region=pampanga`
also loads **Angeles City** (an independent city with its own PSGC code). Neither region has lease corridors
yet — sites there show honest gaps on the lease module until comps are loaded (`prisma/data/lease/README.md`).

### Gap-filling with the admin screen (Admin → Place Capture)

For a district rather than a province: drop the site pin (any of the 18 regions), tick the business types, **Show places on
the map** (layers load one at a time; places BSA already has are shown faded and never saved again), add more areas if you
like, review the Captured areas table, **Save**, and read the status screen. Grid Navigator field sessions are imported from the same screen (save the session
*without* map tiles). Hand-placed pins are Assumed until an admin confirms them on the ground. Load the
region's boundaries first so captured places get barangay/city tags.

### Capture Coverage & the retry queue (2026-10-08)

Admin → **Capture Coverage** shows every saved capture on a map (green = fresh, grey = re-capture due), the capture
log, and the **retry queue** of areas/layers OpenStreetMap did not return completely. Needs migration
`20261008000000_capture_gaps` (Netlify runs `prisma migrate deploy` on build; locally `npx prisma migrate deploy`).
Best practices: `docs/PLACE_CAPTURE_PLAYBOOK.md`.

### After the 2026-10-07 scoring fix — refresh stored composites

Territory Guard is now a deal-breaker in the Final Report: own-branch overlap ≥ 40 % ("Redistributes") caps the
composite at 44 and forces **No-Go**; 15–40 % caps it at 64 (Caution). New runs get this automatically. To fix
runs already saved, run once from the app folder: `npm run db:recompute-composites -- --dry` (preview), then
`npm run db:recompute-composites`.

### Local-first path (recommended for big provinces — 2026-09-28)

The OSM sweep waits minutes on Overpass between writes, and Neon's free tier suspends an idle database,
which can drop the connection mid-load. Load into the local Docker Postgres first, then copy the region to
Neon in one fast pass (`prisma/pushRegion.ts` — upserts `admin_boundary` by `psgc_code` and `poi` by
`(osm_type, osm_id)` (legacy rows by `osm_id`); never copies local ids; safe to re-run). PowerShell, from `4 - Final Application`:

```powershell
docker compose up -d
$env:DATABASE_URL = "postgresql://bsa:bsa_local_dev@localhost:5433/bsa_dev?schema=public"
$env:DIRECT_URL   = "postgresql://bsa:bsa_local_dev@localhost:5433/bsa_dev?schema=public"
npx prisma migrate deploy
npm run db:fetch-boundaries -- --region=cavite
npm run db:ingest:osm:cavite
npm run db:ingest:osm:transport:cavite
npm run db:tag-boundaries
Remove-Item Env:DATABASE_URL
Remove-Item Env:DIRECT_URL
npm run db:push-region -- --region=cavite --dry-run
npm run db:push-region -- --region=cavite
npm run db:tag-boundaries
```

The two `$env:` lines point ONLY this PowerShell window at Docker; `Remove-Item` switches it back to Neon
(from `.env`). The push refuses to run if source and target are the same database.

## F-17 — Fill the known NCR zonal gaps  (Data · Low)

San Juan is missing and Valenzuela needs barangay-level grain. Download the current BIR zonal-value
schedules for those RDOs, drop them into `prisma/data/zonal/` in the documented CSV/JSON shape, and load:

```bash
npm run db:load-zonal
```

Zonal values are a **tax-reference floor only** (guardrail) — they never become a price verdict.

## F-16 — Travel-time isochrone catchments  (Data · Low · future enhancement)

Trade areas are currently fixed circles by format (600–1,200 m) — they ignore rivers, highways and gated
areas. To make them travel-time based:

1. Stand up an isochrone source: self-hosted **OSRM** or **Valhalla**, or a hosted isochrone API (key in
   env, PH-restricted).
2. Add a small provider module (e.g. `lib/geo/isochrone.ts`) that returns a polygon for `(lat, lon,
   minutes)` and **cache it per site** (a new table or `poi_coverage`-style cache — isochrones are stable).
3. Swap the circle in `lib/modules/territoryMath.ts` for the polygon where one is available, falling back
   to the circle when the service is down (never block a run on it).

This is a genuine enhancement, not a bug — the circle model is documented and works today.

---

### Already handled in code (for reference)
- F-13 lease loader (insert-then-delete), F-25 Google quotas + input bounds, F-26 session revocation,
  F-30 middleware + CSP nonce, F-51 monitoring seam, F-52 docs — all done. See `WORKLOG.md`.
- Deferred dev-team follow-ups: F-43 integration/Playwright E2E (needs a test DB + browser in CI),
  F-44 splitting the three large components into per-tab/step files.
