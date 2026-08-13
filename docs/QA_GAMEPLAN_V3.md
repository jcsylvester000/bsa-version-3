# BSA — User Journey QA v3: Game Plan (Round 2, 10 NEW scenarios)

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-04
**Status:** DRAFT — awaiting approval before execution.

**Mission:** Run a second User Journey QA with **10 brand-new scenarios** — different
businesses, drawn from the Excel demand clusters, none reused from Round 1. Same
rigor: each scenario must pass **3/3 gates** before the next.

---

## Why these 10 (novelty is the point)

Round 1 used one brand from 10 clusters: Macao Imperial Tea, Jollibee, Red Ribbon,
Starbucks, Bench, Mercury Drug, 7-Eleven, Petron, Cebuana Lhuillier, Anytime Fitness.

Round 2 deliberately picks **different brands** AND leans into the **10 clusters Round 1
never touched** (casual dining, salon, spa, laundry, diagnostics, hotel, education, water
station, automotive, "other"), plus fresh brands inside the F&B clusters to re-test the
competitor discriminator on new concepts. All 10 already have real outlets in the DB.

| # | New scenario (brand) | Cluster | Vertical | New vs Round 1 | Modules stressed |
|---|---|---|---|---|---|
| 1 | **Chowking** | QSR / Chinese-Filipino | fnb_qsr | new brand + concept | Territory (QSR relevance), Daypart |
| 2 | **Max's Restaurant** | Casual / Full-Service Dining | fnb_qsr | **new cluster** | Territory, Lease (high-capital) |
| 3 | **Gong Cha** | Beverage / Milk Tea | fnb_cafe | new brand — re-tests milk-tea filter | Territory (milk-tea vs coffee) |
| 4 | **Watsons** | Pharmacy / Health Retail | pharmacy | new brand (mall format) | Healthcare, Mall-adjacency |
| 5 | **David's Salon** | Salon / Barber / Nails | services_salon | **new cluster** | Informal-competitor, site-fit |
| 6 | **Ace Water Spa** | Spa / Wellness | services_spa | **new cluster** | Mall, Informal, pricing-viability |
| 7 | **Hi-Precision Diagnostics** | Health / Diagnostics | diagnostics | **new cluster** | Healthcare proximity |
| 8 | **Go Hotels** | Hotel / Travel / Leisure | hotel | **new cluster** | Land & Traffic |
| 9 | **Kumon** | Education / Review Center | education | **new cluster** | Daypart/seasonality, school-proximity |
| 10 | **Aquabest** | Water Station / Refilling | other→convenience-like | **new cluster** | site-fit (tight-radius density) |

This set exercises **9 clusters and several modules Round 1 didn't** (Land & Traffic via
hotel, Mall via spa/pharmacy, Healthcare via diagnostics, Informal via salon/spa), so it's
a real expansion of coverage — not a re-run with different names.

---

## The 3 gates (unchanged — 3/3 to advance)

Same gates as Round 1, applied per scenario:

- **Gate A — Data sufficiency.** Site-fit gets a real (non-zero) demand read; Territory
  finds the brand's own outlets; where the vertical uses Lease, the candidate resolves to
  a corridor with ≥5 comps. If thin → research + ingest real data into Docker Postgres via
  `db:populate`, then re-run. No fabricated numbers.
- **Gate B — Competitor relevance (Google Maps).** The concept-aware pull returns genuine
  same-concept competitors. Round 2 specifically re-validates the F&B discriminator on
  **new concepts** (Chowking = Chinese-Filipino QSR; Gong Cha = milk-tea; Max's = casual
  dining) and validates non-F&B concepts not tested before (diagnostics, spa, salon, hotel,
  education, water station).
- **Gate C — Intake UX + result integrity.** The right modules fire for the vertical; every
  candidate gets a verdict; Truth Layers present; a user could complete the journey (incl.
  the new map-pin). Output is meaningful for the scenario.

---

## New things this round will specifically probe

Because these clusters are new, I expect (and will tag) findings the Round-1 brands couldn't surface:

- **Casual dining (Max's):** is Territory/Lease sensible for a high-capital, low-density
  full-service format (vs. a QSR)? `[CORRECTNESS]` if the QSR competitor set is too broad.
- **Diagnostics + Pharmacy (Hi-Precision, Watsons):** does the Healthcare-proximity module
  find real clinics/hospitals as referral sources? `[DATA-GAP]` if the health POI layer is thin.
- **Hotel (Go Hotels):** does the Land & Traffic module produce a sensible read for an
  asset-acquisition use case? `[CORRECTNESS]`/`[DATA-GAP]`.
- **Spa/Salon (Ace Water Spa, David's):** does the Informal-competitor flag fire, and does
  the concept pull avoid counting unrelated services? `[MAPS-RELEVANCE]`.
- **Water station (Aquabest):** tight-radius density — does site-fit read the right small
  catchment? `[CORRECTNESS]`.
- **Education (Kumon):** seasonality/daypart + school proximity. `[DATA-GAP]` on school POIs.

Any competitor-relevance gap found for a NEW concept feeds a refinement of the concept
taxonomy in `lib/places/competitorRelevance.ts` (e.g. add a `chinese_qsr`, `casual_dining`,
`diagnostics`, `hotel` concept with the right allow/deny signals) — the same mechanism that
fixed milk-tea in Round 1.

---

## Execution order

1. **Define the 10 new scenario fixtures** (real outlets + candidate sites, from the DB —
   each brand already has real outlets; I'll pick clean NCR candidates).
2. **Add any new concepts** the discriminator needs for the new verticals (Chinese-QSR,
   casual dining, diagnostics, hotel, spa, salon, education, water) with allow/deny signals,
   + unit tests.
3. **Scenario 1 → gates A/B/C**, fix root causes (data ingest and/or concept refinement)
   until 3/3. Then scenarios 2–10, each 3/3 before advancing.
4. **Research + ingest** any data gap the new clusters expose (health POIs, new corridors,
   thin demographics near new candidates) into Docker Postgres — real/grounded, Truth-Layered.
5. **Final pass** — full test suite + build green; tagged findings in
   `docs/QA_JOURNEY_FINDINGS_V3.md`; deliver changed files + data + the `db:populate`
   commands so you reproduce the dataset locally.

---

## What "done" looks like

- 10 brand-new scenarios (no Round-1 reuse), covering 9 clusters Round 1 skipped.
- 10/10 pass 3/3 gates.
- Competitor relevance validated on new concepts; taxonomy extended where needed.
- Any new data gaps filled with researched real data in the Docker DB (commands provided).
- `QA_JOURNEY_FINDINGS_V3.md` tags every issue + fix.

---

## Approval

Approve to begin, or adjust the 10 picks (e.g. swap a brand, or force a specific cluster).
On approval I start by defining the fixtures and the new concepts, then run Scenario 1
through its 3 gates.
