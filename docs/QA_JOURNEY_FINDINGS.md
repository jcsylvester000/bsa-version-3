# BSA — User Journey QA Findings (Phase 3)

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-04
**Scope:** 10 user-journey scenarios run end to end through the REAL pipeline
(intake → outlets → run → candidates → `runPipeline` → module_results → verdict)
against the populated database (~2,270 real outlets, 2,452 POIs, real malls, curated
zonal/demographics/lease). Each journey uses one of the 10 real-brand prefill scenarios.

---

## Method

A QA harness created a real franchisor + intake + run + candidate sites from each of
the 10 demo scenarios, executed the actual pipeline orchestrator (the same code the
app runs), and inspected the resulting `module_result` rows for: correct module
activation per vertical, Territory Guard overlap + real-competitor discovery, Lease
corridor resolution, candidate verdicts, and Truth-Layer honesty. QA rows were cleaned
up after each run.

---

## Result summary

| # | Journey | Vertical | Modules run | Pipeline | Notable |
|---|---------|----------|-------------|----------|---------|
| 1 | Macao Imperial Tea | fnb_cafe | site_fit, territory, lease, daypart, informal | ✅ ready | 75% overlap → caution; 20 real competitors |
| 2 | Jollibee | fnb_qsr | site_fit, territory, lease, daypart, informal | ✅ ready | go(97); 20 competitors |
| 3 | Red Ribbon | fnb_bakery | site_fit, territory, lease, daypart | ✅ ready | go(92); 20 competitors |
| 4 | Starbucks | fnb_cafe | site_fit, territory, lease, daypart, informal | ✅ ready | 69% overlap → caution; 20 competitors |
| 5 | Bench | retail_apparel | site_fit, territory, lease, mall | ✅ ready | nogo(28); mall module fired |
| 6 | Mercury Drug | pharmacy | site_fit, territory, lease, healthcare | ✅ ready | nogo(0) — see F3 |
| 7 | 7-Eleven | convenience | site_fit, territory, lease, whitespace | ✅ ready | white-space fired |
| 8 | Petron | fuel | site_fit, territory, lease, land | ✅ ready | land module fired |
| 9 | Cebuana Lhuillier | remittance | site_fit, territory, lease, whitespace | ✅ ready | competitors=0 — see F4 |
| 10 | Anytime Fitness | services_fitness | site_fit, territory, lease, daypart | ✅ ready | 44% overlap; 20 competitors |

**All 10 journeys complete with the correct modules firing per vertical.** No journey
crashed; every candidate received a verdict. The findings below are quality gaps the
real data exposed, not failures of the pipeline itself.

---

## Findings, fixes, and recommendations

### F1 — Territory Guard did not pull real competitors in the pipeline path **(FIXED)**

**Finding.** Real Google-Places competitor discovery existed only in mock mode and in
the `/api/territory-guard` route. The pipeline orchestrator (`runPipeline` →
`runTerritoryGuard`) never populated `realCompetitors`, so every DB-mode run persisted
0 competitors into its `module_result` — the dashboard/report competition read was blank.

**Fix applied.** `runTerritoryGuard` now takes the run's `vertical` and pulls real
competitors via `nearbyForVertical`, persisting them into the module payload. The API
route passes the vertical too and reuses that result (dropping its duplicate Google
call). After the fix, 9/10 journeys show 20 real competitors.

**Truth Layer.** Competitor coordinates are Verified (Google); the pull is best-effort
(empty list if the key is absent or the call fails), never fabricated.

### F2 — Lease Benchmark silently skipped where comps existed **(FIXED)**

**Finding.** `inferCorridor` only mapped BGC / Ortigas / Makati. Candidates in Quezon
City and the Pasay Bay Area — corridors that DO have comps in `lease_comp` — returned
null, so Lease was skipped for those journeys even though the data was present.

**Fix applied.** `inferCorridor` extended to map QC (Quezon City / Cubao / Timog /
Katipunan / Araneta) → `Quezon City`, and Pasay / MOA / Bay Area → `Pasay Bay Area`,
matching the corridors that hold comps. Most-specific tokens (BGC) still win. Locked in
with 4 new unit tests.

### F3 — Thin demographic coverage collapsed site-fit for some candidates **(MITIGATED + DATA GAP)**

**Finding.** Site-fit's demand pillar sums `demographic_cell` population within 1.2 km of
the candidate. Only ~30 demographic cells are seeded (NCR sample), so a candidate with no
cell nearby (e.g. Mercury Drug's QC Timog site) got demand = null → composite collapsed
to 0 → verdict nogo(0). Honest, but it under-read real sites as if they had zero catchment.

**Fix applied (interim mitigation).** When no cell is within the primary radius, site-fit
now falls back to the NEAREST cell within a wider radius (6 km — sized to the current sparse
sample) as a demand proxy, and drops that pillar's Truth Layer to **Assumed**. After the fix,
QC Timog lifted from nogo(0) → nogo(34.1) with `site_fit.truthLayer = assumed` — a real,
honestly-labelled score instead of a false zero. The verdict can still be a genuine no-go;
the point is it's no longer a data-absence artifact.

**What data still to upload (the real fix).** A denser `demographic_cell` layer — ideally all
NCR barangays (~1,700) with real PSA populations and PSGC codes, then key regional cities. The
loader (`loadDemographics`) already supports this; it just needs a fuller `demographics.real.json`
(or a PSA bulk source). The fallback is a stopgap, not a substitute for real coverage.

### F4 — Remittance competitor mapping is thin **(DATA/CONFIG)**

**Finding.** The `remittance` vertical maps to `bank`/`finance` Google types; the Divisoria
candidate returned 0 competitors. Pawn/remittance outlets are often typed as `finance` or
untyped on Google, so the competitor read undercounts exactly the informal-heavy category
the workbook flags.

**Recommendation.** Add a text-search fallback for remittance (`"remittance padala pawnshop"`)
alongside the type filter, and surface the informal-competitor caveat in the UI. Same pattern
applies to salon/laundry (informal-heavy) — the informal module already flags this.

### F5 — Lease coverage is NCR-corridor-only **(DATA GAP, expected)**

**Finding.** Candidates in Marikina, Muntinlupa/Alabang, Mandaluyong and Manila have no
`lease_comp` corridor, so Lease honestly reports insufficient. This is correct behavior, but
it means Lease only benchmarks 5 corridors today (BGC, Makati CBD, Ortigas, QC, Pasay).

**What data to upload.** Additional corridor bands (Alabang/Filinvest, Mandaluyong/Boni,
Manila/España, Marikina) into `lease.real.json`. The loader already supports any corridor; the
gap is purely the curated dataset breadth.

---

## New-implementation recommendations (surfaced by the real data)

1. **Demographic fallback + freshness flag** — nearest-cell fallback (F3) and a per-pillar
   "data thin here" indicator so a nogo(0) is distinguishable from a genuine no-go.
2. **Bulk demographic ingest** — a PSA barangay import to lift NCR from ~30 to full coverage,
   which lifts site-fit accuracy across every journey.
3. **Competitor text-search fallback** for informal-heavy verticals (remittance, salon, laundry).
4. **Corridor auto-derivation from geocoding** — replace the keyword `inferCorridor` with a
   reverse-geocode → corridor map so new cities resolve without a code change.
5. **Multi-region populate** — `db:populate --region` beyond NCR (Cebu, Davao) once the NCR
   dataset is validated, to exercise the pipeline outside Metro Manila.

---

## Fixes applied in this pass (verified)

- **F1** real competitors now pulled + persisted in the pipeline path (`territoryGuard.ts`,
  `orchestrator.ts`, `api/territory-guard/route.ts`).
- **F2** `inferCorridor` extended for QC + Pasay (`orchestrator.ts`) + 4 unit tests.
- **F3** nearest-cell demand fallback (Assumed-flagged) so thin-coverage sites get a real
  score instead of nogo(0) (`siteFit.ts`).
- Verification: `tsc` clean (app + scripts), full suite green (**163 tests**), QA harness
  re-run shows competitors populated (9/10 journeys, 20 each), the QC lease case resolving,
  and QC Timog lifting from nogo(0) → nogo(34.1, Assumed).

Remaining data-layer findings (F4–F5, and the denser-demographics half of F3) are
dataset-breadth items — documented with the exact loader/file that closes each, to be
scheduled as a data pass.
