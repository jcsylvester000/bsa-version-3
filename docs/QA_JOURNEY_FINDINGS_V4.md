# BSA — User Journey QA v4: Findings & Fixes (Round 3 — 10 HARDER scenarios)

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-05
**Plan:** `docs/QA_GAMEPLAN_V4.md`
**Result:** **ALL 10 HARDER SCENARIOS PASS 3/3** — and this round surfaced + fixed a real
falsely-confident-score bug.

10 harder scenarios built to STRESS the app: the untested **Automotive** cluster, **thin
own-networks** (2–8 outlets), **edge geographies** (Valenzuela, Las Piñas), and **ambiguous
concepts**. Passing here means correct, HONEST output under stress — including degrading
honestly on thin data rather than inventing a confident number.

---

## Final gate results (all 3/3)

| # | Brand | Stressor | A · data / honesty | B · concept relevance | C · integrity |
|---|---|---|---|---|---|
| 1 | Rapide | Automotive (new cluster) | ✓ 43.4 · QC/6 | ✓ 20 auto-service | ✓ 4 mods |
| 2 | AutoPlus | **2 outlets** | ✓ 57.3 · Makati/6 | ✓ 20 auto-service | ✓ 4 mods |
| 3 | Healthway | clinic vs diagnostics | ✓ 43.4 · QC/6 | ✓ 20 clinics/labs | ✓ 4 mods |
| 4 | Nail Spa | nail vs beauty/massage | ✓ 58.8 · Makati/6 | ✓ 20 nail salons | ✓ 5 mods |
| 5 | National Book Store | bookstore vs retail | ✓ 58.8 · Mandaluyong/5 | ✓ 18 bookstores | ✓ 4 mods |
| 6 | Ministop | **8 outlets** | ✓ 58.8 · Ortigas/6 | ✓ 20 convenience | ✓ 4 mods |
| 7 | Mang Inasal | grilled vs burger QSR | ✓ 46.8 · QC/6 | ✓ 13 grilled-chicken | ✓ 5 mods |
| 8 | Lava Lava | **2 outlets**, tiny radius | ✓ 58.8 · Makati/6 | ✓ 20 laundromats | ✓ 4 mods |
| 9 | Shell | **edge (Valenzuela)** | ✓ 33.3 · **lowConf** · CAMANAVA/5 | ✓ 20 fuel | ✓ 4 mods |
| 10 | M Lhuillier | **edge (Las Piñas)** | ✓ 58.8 · Las Piñas/5 | ✓ 20 remittance | ✓ 4 mods |

Shell passing at **33.3 / low-confidence** (not a false high score) is the point of this round.

---

## Findings (captured → tagged → fixed)

### `[CORRECTNESS]` **BLOCKER — falsely-confident perfect score on data-sparse sites (FIXED)**
The most important finding of the whole QA effort. A candidate in an edge geography with **no
demographic data** (Valenzuela) scored a **composite of 100 → "Go"**, because `compositeScore`
takes a weighted mean over only the *scored* pillars and re-normalizes: with demand null and
accessibility null, a lone competition-headroom pillar at 100 became a perfect 100 — a
confident "Go" the app had no right to give.

**Fix (`lib/modules/siteFitMath.ts`).** The demand pillar is the primary driver. When it is
DEFINED for the run but has no score, the composite is **capped at 44** (below the "caution"
floor, so never a "Go"), the verdict downgrades, the Truth Layer can't be Verified, and a
`low_confidence_no_demand_data` flag is set. Valenzuela now reads **33.3 · nogo · Assumed ·
low-confidence** instead of 100/Go. 2 new unit tests lock it in (cap when demand missing; no
cap when demand IS scored). This makes the app degrade HONESTLY under thin data — the core
objective.

### `[MAPS-RELEVANCE]` Major — hard/ambiguous concepts needed discriminators (FIXED)
New concepts added to `lib/places/competitorRelevance.ts`, each verified against live Google:
- **automotive** — `car_repair` type, excludes car-wash (12/12 auto-service kept).
- **grilled_qsr** (Mang Inasal) — chicken/BBQ types + grill name signals; keeps Bacolod,
  Peri-Peri, Gerry's Grill, drops Texas Roadhouse (steak) / Al Carbon (Mexican) / burger QSR
  (7/12 correctly).
- **nail_salon** — `nail_salon` type, excludes barber/massage (12/12).
- **bookstore** — `book_store` + name signals, excludes clothing/general store (11/12).
`conceptFor` sub-routes fnb_qsr for grilled, and routes nail/bookstore by name. 8 new tests.

### `[DATA-GAP]` Major — no lease corridor for edge cities (FIXED)
Valenzuela and Las Piñas didn't map to any lease corridor, so Lease Benchmark dropped for
edge candidates. **Fix.** Added two secondary-market corridors to `lease.real.json` —
**CAMANAVA** (Caloocan/Valenzuela/Malabon/Navotas, ₱500–1,300) and **Las Piñas** (₱600–1,400),
grounded in published suburban-retail listings and clearly labelled **Assumed**. `inferCorridor`
maps those cities. Lease now runs for both edge scenarios (5 comps each).

### `[CORRECTNESS]` — thin (2-outlet) networks behave correctly (VERIFIED, no fix)
AutoPlus and Lava Lava have only 2 outlets. Verified Territory Guard measures overlap against
the actual nearby outlet(s) and doesn't fabricate a network — a 2-outlet brand near one of its
outlets correctly reads high overlap; away from both, low. No false "adds everywhere". Honest.

---

## Coverage after three rounds

30 scenarios; **all 20 Excel clusters now tested** (Automotive was the last untouched one).
Modules exercised: the full set. Stress conditions covered: tiny networks (2 outlets), edge
geographies, and a dozen ambiguous concepts through the discriminator.

---

## Verification

- All 10 HARDER scenarios **PASS 3/3**, including honest low-confidence on edge geographies.
- The falsely-confident-score bug is fixed and can't regress (unit-tested).
- New concepts proven live; lease corridors extended to 11.
- app tsc ✓, scripts tsc ✓, `next build` ✓, vitest **224 tests** ✓.

## Residual / future (non-blocking)

- Full PSA barangay demographics would replace the nearest-cell Assumed fallback with Verified
  reads in edge geographies (the cap fix makes today's behaviour honest in the meantime).
- Verified lease comps for the secondary corridors (currently grounded Assumed estimates).
- Hotel tourism-flow pillar (carried from v3).
