# BSA — QA Brutal: Region XI (Davao) Market-Readiness — Findings

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-05
**Method:** the NCR Brutal Test template (`docs/QA_GAMEPLAN_V6_BRUTAL.md`) applied to Region XI.
**Result:** **ALL 20 EXCEL CATEGORIES PASS 3/3 across the Davao Region.**

The first region beyond NCR. All 20 Excel business categories were run through the **real
pipeline** at **2 Davao candidate sites each** — Davao City commercial cores (Downtown, Lanang,
Bajada, Matina, Buhangin, Talomo, Ma-a, Agdao) and the provincial cities (Tagum, Digos, Panabo,
Samal/IGACOS, Mati) — judged by the same Services-Sought bar. Deterministic: 20/20 on two
independent full runs.

---

## Final gate results — 20/20 pass 3/3

Every category resolved with real Davao data and its required modules delivered genuine,
input-varying output. Highlights proving the data is real, not empty-passing:

- **Territory Guard** pulled 20 concept-relevant competitors per Davao site. Milk Tea (#3)
  returned actual Davao tea shops — Cha Tuk Chak Lanang, Tiger Bubble Tea, "Comma teaspresso
  cafe," Cha Cha Cups — **not** coffee shops. The concept discriminator carries to a new region.
- **Lease Benchmark** resolved **6 comps** in the Davao City corridor (SM Lanang / Abreeza /
  SM Ecoland + downtown high-street) and 5 in Davao Provinces.
- **Mall Intelligence** varied by real mall: Abreeza scored 46, SM Lanang 74 — different
  properties, different tiers, not a constant.
- **Healthcare** scored against real Davao facilities (Downtown & Bajada diagnostics = 100).
- **Capacity** (water/salon/laundry) varied by catchment: water pop-per-unit 61,698 (Talomo)
  vs 50,000 (Digos), each with a real breakeven read.
- **Access scoping** held for every role (franchisor / broker / analyst).

---

## The one real gap this region surfaced — and the fix

### `[DATA-GAP-REGION]` BLOCKER — Davao had ZERO competitor / mall / health POIs **(FIXED)**
The demographics, zonal, and lease data were straightforward to add, but the first structural
check found the **POI, mall, and healthcare layers were NCR-only**. The original Google Places
sweep was seeded on an NCR grid, so Davao had **0 competitors, 0 malls, 0 health facilities** —
which would have silently starved Territory Guard, Mall Intelligence, Healthcare, White-Space,
and the Informal/capacity read for every Davao candidate.

**Fix.** Ran the Places ingest against a **Davao sweep grid** (11 cells: Downtown, Lanang,
Bajada, Matina, Buhangin, Talomo/Ecoland + Tagum, Digos, Panabo, Mati, Samal) plus Davao-specific
mall queries. Pulled real, coordinate-Verified data:

- **1,361 competitor POIs** across the Davao region
- **73 malls** (SM Lanang Premier, Abreeza Ayala, SM City Davao, Gaisano, NCCC, provincial)
- **369 healthcare facilities** (hospitals / clinics / diagnostics)

Every Davao module now resolves with real data. This is the key lesson for future regions: the
**POI/mall/health layer must be swept per-region**, not assumed from NCR — the harness catches it
immediately because the modules go empty.

No other defects. The NCR fixes (lease corridor fallback, Pasig/San Juan/Pateros corridors, the
land-parcel + capacity + mall-tier module wiring) all carried over cleanly — which is exactly
what a reusable template should do.

---

## Davao data floor (Gate A) — the 6 LGUs

- **Demographics:** Davao City (8 key barangays — Bucana, Buhangin, Talomo, Ma-a, Matina
  Crossing, Poblacion, Sasa/Lanang, Agdao) + Digos, Tagum, Panabo, Samal, Mati. Real PSA 2020
  populations + official city PSGC codes; `daytime_pop` estimated from commercial character
  (downtown / Lanang pull daytime > residential), labelled Assumed.
- **Zonal:** Davao City from the real per-street BIR schedule (Ramon Magsaysay ₱63.3k–65.7k,
  JP Laurel/Bajada ₱56k, San Pedro downtown ₱49k–56.9k; interior ₱15.7k) — Verified. Digos /
  Tagum / Panabo / Samal / Mati grounded approximates, labelled in `notes` as verify-before-use.
- **Lease:** two corridors — **Davao City** (6 comps: SM Lanang / Abreeza / SM Ecoland +
  downtown high-street + Matina/Buhangin inline) and **Davao Provinces** (5 comps, secondary
  provincial retail). `inferCorridor` maps Davao City cores → Davao City; Tagum/Digos/Panabo/
  Samal/Mati → Davao Provinces.

Truth-Layer honesty preserved: census populations and the Davao City BIR schedule are Verified;
daytime estimates, approximate provincial zonal, and aggregator-derived mall rents are Assumed
and labelled.

---

## Verification

- **20/20 categories pass 3/3**, deterministic across two independent full runs.
- Every Davao LGU resolves with real demographics (incl. `daytime_pop`), a lease corridor with
  ≥5 comps, real competitor/mall/health POIs, and zonal.
- Genuineness spot-checked live: milk-tea competitors are real tea shops; mall scores vary by
  property; capacity varies by catchment; healthcare scores against real facilities.
- app `tsc` ✓, scripts `tsc` ✓, `next build` ✓, vitest **237 tests** ✓ (+ Davao corridor cases).

## Residual / future (non-blocking, honestly flagged)

- **Zonal precision:** only Davao City is BIR-Verified; the 5 provincial cities are approximate
  (labelled). Replace with each RDO's schedule when available.
- **Lease comps:** Davao mall rents are aggregator-derived (Occupi) and grounded-Assumed, not
  landlord-published; downtown high-street is an estimate.
- **Barangay PSGC:** Davao City key-barangay codes are the verified/representative set; the full
  182-barangay codes are on the PSA portal if needed.
- **Provincial POI density:** the sweep covered the provincial city centers; deeper coverage of
  smaller municipalities would enrich White-Space in sparse areas (honest via flags today).

## Template confirmed reusable

The Brutal Test transferred to a second, distinct metro with **one region-specific gap** (the
per-region POI sweep) and zero code regressions. To onboard the next region: add its
demographics/zonal/lease to the `.real.json` files, extend `inferCorridor` with its corridors,
run the Places sweep on that region's grid, point the harness sites at it, and run. That is the
whole playbook.
