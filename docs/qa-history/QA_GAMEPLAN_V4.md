# BSA — User Journey QA v4: Game Plan (Round 3 — 10 HARDER scenarios)

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-05
**Status:** DRAFT — awaiting approval before execution.

**Mission:** A third User Journey QA — **10 harder scenarios** using brands/industries not
used in Rounds 1–2, and deliberately built to STRESS the app rather than walk the happy
path. Same rule: each scenario must pass **3/3 gates** before the next.

---

## What "harder" means here (and why)

Rounds 1–2 covered 20 brands across 19 of 20 clusters on candidates chosen to have plenty of
data. That's the easy surface. Round 3 raises difficulty three ways, each a real risk to
"accurate numbers / meaningful results":

1. **Untested cluster + thin-outlet brands.** Automotive was never tested. `AutoPlus` (2
   outlets), `Lava Lava` (2), `Ministop` (8) stress the pipeline when the brand's own
   network is tiny — does Territory Guard still behave, does the report stay honest?
2. **Edge / sparse geographies.** Candidates outside the dense NCR core (Caloocan, Las Piñas,
   Novaliches, Valenzuela) where demographic + competitor data is thinnest — the real test of
   the Gate-A fallback and honest "insufficient" behaviour.
3. **Cross-concept ambiguity.** Concepts where Google's categories bleed: `automotive` (car
   repair vs tire shop vs car wash vs parts), `Healthway` (clinic vs diagnostics vs hospital),
   `Nail Spa` (nail salon vs beauty spa vs massage), `National Book Store` (bookstore vs
   general retail / office supply). These push the competitor discriminator hardest.

A scenario "passing" here means the app produces correct, honest output **under stress** —
including correctly saying "insufficient data" when that's the truth, rather than inventing a
number. Thin data that the app flags honestly is a PASS; thin data that produces a
falsely-confident number is a FAIL to be fixed.

---

## The 10 harder scenarios

| # | Brand | Cluster | Hard because… | Stresses |
|---|---|---|---|---|
| 1 | **Rapide** | Automotive ⭑ | untested cluster; land/traffic + car-service concept | Land & Traffic, concept (auto) |
| 2 | **AutoPlus** | Automotive ⭑ | **2 outlets** — tiny own-network | Territory w/ sparse network |
| 3 | **Healthway Medical** | Diagnostics/clinic | clinic vs diagnostics vs hospital ambiguity | Healthcare, concept overlap |
| 4 | **Nail Spa** | Spa/nails | nail vs beauty vs massage concept bleed | concept, Informal |
| 5 | **National Book Store** | Specialty retail ("Other") | bookstore vs general/office retail | concept (retail_specialty) |
| 6 | **Ministop** | Convenience | **8 outlets**; competes w/ 7-Eleven density | White-Space at thin scale |
| 7 | **Mang Inasal** | QSR (grilled) | grilled-chicken sub-concept vs burger QSR | concept (QSR sub-type) |
| 8 | **Lava Lava Laundry** | Laundry | **2 outlets**; hyper-local tiny radius | site-fit tight radius, thin net |
| 9 | **Shell** | Fuel | edge geography (Caloocan/Valenzuela candidate) | Land & Traffic, sparse demo |
| 10 | **M Lhuillier** | Remittance | edge geography (Las Piñas/Novaliches) | White-Space, sparse data |

⭑ Automotive = a cluster never tested in R1/R2. Thin-outlet (2–8) and edge-geography cases are
the deliberate stressors.

---

## The 3 gates (same rule, harder bar)

- **Gate A — Data sufficiency / honesty.** Site-fit gets a real demand read OR the app
  honestly flags it thin (Assumed / insufficient) — a falsely-confident number on thin data
  FAILS. Territory finds the brand's outlets (even if only 2). Lease resolves a corridor with
  ≥5 comps where the vertical uses it. Where a candidate sits in a sparse area, the correct
  behaviour is honest degradation, which I verify explicitly. Fill real data only where a true
  gap (not honest thinness) blocks a meaningful result.
- **Gate B — Competitor relevance (Google Maps).** The concept pull returns genuine
  same-concept competitors for the HARD concepts: automotive (car repair/service, not car
  wash/parts-only unless relevant), grilled-chicken QSR (Mang Inasal vs burger QSR),
  nail/beauty spa, bookstore-vs-general-retail. New concepts added to the discriminator as
  needed (e.g. `automotive` refinement, `grilled_qsr`, `nail_salon`, `bookstore`), each with
  a live relevance check + unit tests.
- **Gate C — Intake UX + result integrity.** Right modules fire; every candidate gets a
  verdict OR an honest "insufficient"; Truth Layers present; the map-pin + real-entry intake
  work; output is meaningful (or honestly caveated) for the scenario.

---

## New things this round will specifically probe (pre-tagged)

- `[MAPS-RELEVANCE]` — automotive concept bleed (repair vs wash vs parts); grilled-chicken vs
  burger QSR; nail-spa vs massage; bookstore vs general retail. Fixes go into the concept
  taxonomy, same mechanism as milk-tea/Chinese-QSR.
- `[CORRECTNESS]` — does Territory Guard stay sane with a **2-outlet** network (AutoPlus,
  Lava Lava)? Does a tiny own-network wrongly read as "adds everywhere"?
- `[DATA-GAP]` — edge geographies (Caloocan, Las Piñas, Valenzuela, Novaliches): is demand
  honestly thin-flagged, or falsely zero/confident? Fill with real data only if a genuine gap.
- `[UX-IMPROVE]` — does the report/scorecard clearly communicate low-confidence on thin data,
  so a user isn't misled? If not, that's a fix.

---

## Execution order

1. **Add/refine hard concepts** in `competitorRelevance.ts` (automotive, grilled_qsr,
   nail_salon, bookstore) with live relevance checks + unit tests.
2. **Define the 10 fixtures** from real DB outlets (incl. the thin 2-outlet brands) with edge
   candidates where the plan calls for sparse geography.
3. **Scenario 1 → gates A/B/C**, fix root causes (concept refinement, data ingest, or an
   honesty/confidence-display fix) until 3/3. Then 2–10, each 3/3 before advancing.
4. **Research + ingest** real data only where an edge geography is a true gap (not honest
   thinness) — into Docker Postgres, Truth-Layered.
5. **Final pass** — full test suite + build green; tagged findings in
   `docs/QA_JOURNEY_FINDINGS_V4.md`; deliver changed files + data + `db:populate` commands.

---

## What "done" looks like

- 10 harder scenarios (new brands incl. the untested Automotive cluster, thin-outlet + edge
  cases), 10/10 pass 3/3 — where "pass" includes **honest degradation** on genuinely thin data.
- Competitor relevance holds for the hard/ambiguous concepts; taxonomy extended where needed.
- Any true data gap filled with researched real data in the Docker DB (commands provided).
- Any case where the app was falsely-confident on thin data is fixed to read honestly.
- `QA_JOURNEY_FINDINGS_V4.md` tags every issue + fix.

---

## Approval

Approve to begin, or adjust the 10 picks / the difficulty emphasis (e.g. more edge geography,
or force a specific brand). On approval I start with the hard concepts, then run Scenario 1
through its 3 gates.
