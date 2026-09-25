# BSA — Regional QA: CALABARZON (Cavite + Batangas) — Findings

**Prepared for:** Grid Property Ventures · BSA handoff
**Date:** 2026-09-24
**Scope:** R-08, closing the R-series (regional data expansion beyond NCR/Davao).
**Method:** the region-aware pipeline walked end-to-end for representative Cavite and Batangas sites,
verified by the deterministic resolver test `tests/unit/regionalQa.test.ts` (12 cases, all pass).

## What R-08 checks — and why it's split in two

The CALABARZON expansion has two independent halves, and this QA keeps them honestly separate:

1. **Wiring (code — DONE and guarded).** Does a Cavite/Batangas site route through the *correct*
   region everywhere — corridor, zonal region, traffic key, mall query — instead of falling back to
   NCR? This is pure, deterministic, and now regression-guarded.
2. **Data (owner-loaded — per-layer).** The numbers a resolved module reads (POIs, boundaries,
   demographics, zonal, lease comps, malls, traffic AADT) come from the R-02/R-04/R-05/R-06/R-07
   loaders. Until a layer is loaded for a province, that module **degrades honestly** (says "no data"
   / uses a Projected fallback), it never invents a value or borrows NCR's.

A green wiring result with empty data is the expected pre-load state; it is not a failure.

---

## Part 1 — Wiring: PASS (Cavite + Batangas resolve entirely in-region)

Representative sites — Cavite: Bacoor, Imus, Dasmariñas, General Trias, Tagaytay · Batangas:
Batangas City, Lipa, Sto. Tomas, Tanauan — each walked through the live resolvers:

| Step | Resolver | Cavite result | Batangas result |
|---|---|---|---|
| Region tag (intake) | `resolveAdminBoundary` → else `regionForSite` | `cavite` | `batangas` |
| Canonical LGU | `canonicalCity` | Bacoor / Imus / Dasmariñas / General Trias / Tagaytay | Batangas City / Lipa / Sto. Tomas / Tanauan |
| Lease + Daypart corridor | `inferCorridor` (region-first, R-06) | Bacoor–Imus · Dasmariñas–General Trias · Tagaytay–Silang | Sto. Tomas–Tanauan · Lipa · Batangas City |
| Zonal region (Lease cross-check + Land zoning) | `canonicalCity` → `psaRegion` (R-05) | **IV-A** | **IV-A** |
| Traffic corridor key (seasonality) | `inferCorridor` → `traffic_corridor` | matches R-07 templates | matches R-07 templates |
| Mall Match | nearest `mall_property` by geom | spatial — any loaded provincial mall serves | spatial |

**Anti-regression assertion (the pre-R-06 bug):** every provincial corridor is asserted **not** to be
an NCR corridor, and the zonal region is asserted to be **IV-A, not NCR**. The old "Bacoor → NCR Las
Piñas / NCR zonal" path can no longer come back silently — the test fails if a registry edit
reintroduces it. NCR sites (Makati/BGC/Ortigas) are asserted unchanged in the same run.

**Corridor↔template contract:** the corridor names are pinned to the shipped traffic templates
(`prisma/data/traffic/{cavite,batangas}.template.json`). Renaming a corridor in the registry without
updating its template fails the test.

---

## Part 2 — Data readiness per module (owner load state)

For each module, what a resolved Cavite/Batangas site shows **before** vs **after** the owner runs
the loader. "Before" is the honest-degradation behaviour, verified against the module code.

| Module | Needs (loader) | Before load (honest degradation) | After load |
|---|---|---|---|
| **Territory Guard** (competitors) | POIs — `db:ingest:osm:cavite/:batangas` (R-03) | competitor count 0 → flagged, not scored | real OSM competitors, concept-filtered |
| **Catchment / demographics** | boundaries (R-02) + PSA population (R-04) | "—", no fabricated pop; catchment read withheld | real barangay population + daytime pop |
| **Lease Benchmark** | lease comps — `db:load-lease` (R-06) | corridor resolves; comps thin → BIR-zonal **indicative band** (Projected, R-05) | full corridor range/median/percentile + negotiating room |
| **Lease zonal cross-check / Land zoning** | BIR zonal — `db:load-zonal` (R-05) | "zonal unknown" for the LGU (no NCR borrow) | CR/CC band + rent-to-land cross-check |
| **Mall Match** | mall roster — `db:load-malls` (R-07) | `no_mall_data`, not scored | nearest mall tier/footfall vs target |
| **Daypart & Seasonality** | traffic — `db:load-traffic` (R-07) | vertical term-time note only (no corridor seasonal) | corridor seasonal low/high (province-shaped) |
| **Healthcare / capacity** | POIs (R-03) + demographics (R-04) | nearest-facility null / pop-per-unit withheld | real facility distance + breakeven read |

**Guardrails confirmed in-region:** no price verdict (Lease reports position vs corridor only); BIR
zonal used as a tax-reference floor only; RA 9646 + broker-supplementation framing unchanged; every
provincial figure keeps its Truth Layer (POIs/zonal Verified, demographics Verified/Assumed, lease
Assumed unless a published band, seasonality Projected).

---

## Owner load order (one province, end-to-end)

```powershell
# 1. Admin boundaries (auto-download, no GDAL) + tag existing rows
npm run db:fetch-boundaries -- --region=cavite
npm run db:tag-boundaries   -- --region=cavite
# 2. POIs (run in a quiet Overpass window; tiled + resumable)
npm run db:ingest:osm:cavite
# 3. Demographics, zonal, lease, malls, traffic (CSV/JSON per each README)
npm run db:load-demographics -- --region=cavite --file=prisma/data/demographics/cavite.csv
npm run db:load-zonal        -- --region=cavite --file=prisma/data/zonal/cavite.csv
npm run db:load-lease        -- --region=cavite --file=prisma/data/lease/cavite.csv
npm run db:load-malls        -- --region=cavite --file=prisma/data/malls/cavite.csv
npm run db:load-traffic      -- --region=cavite --file=prisma/data/traffic/cavite.template.json
```

Then submit a Cavite intake and confirm each tab resolves. Repeat with `--region=batangas`. Each
loader is idempotent, so a partial or repeated load is safe.

---

## Result

**Wiring: PASS** for Cavite and Batangas — every site resolves entirely in-region, NCR is unaffected,
and the province→NCR regression is permanently guarded. **Data: owner-loaded per module**, with every
un-loaded module degrading honestly. This closes the R-series; the CALABARZON build is
development-ready pending the owner data loads above.
