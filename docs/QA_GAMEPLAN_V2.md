# BSA — User Journey QA v2: Game Plan & Execution Strategy

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-04
**Status:** DRAFT — awaiting approval before execution.

**Mission:** Remove all pre-filled mock data, then run a rigorous 10-scenario User
Journey QA that answers five questions per scenario — is there enough data for accurate
numbers, is Google Maps pulling the *right* competitors (esp. the F&B category problem),
is lease data sufficient, does the intake UI capture everything (incl. map-pin for
outlets), and where can the journey be improved. Capture → tag → fix. **Each scenario
must pass 3/3 gates before moving to the next.**

---

## What I already confirmed (so this plan is concrete, not guesswork)

Inspected the live DB + code before writing this:

| Area | Current state | Implication |
|---|---|---|
| Outlets / POI | 2,272 outlets · 2,452 POI (1,737 competitor) | Rich for NCR |
| **Demographics** | **30 barangays across 9 cities** | **THIN — site-fit demand pillar reads 0 for many real sites** |
| **Lease comps** | **20 comps across 5 corridors** (BGC 6, Makati 4, QC 4, Ortigas 3, Pasay 3) | **THIN — 5 corridors only; most NCR cities have none** |
| Zonal values | 16 rows, main NCR RDOs | OK for reference |
| **F&B competitor typing** | `fnb_cafe` pulls `cafe`+`coffee_shop`; `fnb_qsr` pulls `restaurant` | **Milk-tea vs coffee vs full-dining all lumped → false competition** |
| Territory verdict | own-outlet overlap only (correct — cannibalization) | Competitors don't skew the verdict ✓ |
| **site_fit competition pillar** | counts ALL `category='competitor'` POI in 800 m, no sub-type filter | **F&B conflict lives HERE — dilutes headroom with unrelated food** |
| **Intake "Existing outlets"** | geocodes a typed address; **no visual map pin** | **UX gap you flagged — add Google Map pin** |

These findings pre-load the fixes; the QA validates and extends them.

---

## Step 0 — Remove all pre-filled mock data (before QA starts)

The "Load demo data" scenarios and in-memory mock compute exist so the app is browsable
with no DB. Per your instruction we strip the pre-fill so QA reflects a real user typing
real data:

- Remove the scenario picker + `DEMO_SCENARIOS` / `DEMO_INTAKE_PREFILL` wiring from the
  intake wizard (no auto-fill button).
- Neutralize `lib/mock/*` demo constants that inject fake outlets/sites/sales into views
  (keep mock-*auth* mode as a no-DB fallback, but it renders empty states, not fake data).
- Intake starts blank; the user enters everything. This is the honest QA surface.

*(The 10 QA scenarios below become test fixtures I drive through the real pipeline — not
pre-fills shipped in the UI.)*

---

## The 10 QA scenarios (unique, real brands, real journeys)

Each is a distinct role × vertical × intent, exercising a different module mix:

| # | Scenario | Vertical | Primary modules under test |
|---|---|---|---|
| 1 | Milk-tea chain, new Makati site | fnb_cafe | Territory (F&B typing!), Lease, Daypart |
| 2 | QSR network expansion | fnb_qsr | Territory at scale, Daypart, Informal |
| 3 | Bakery neighbourhood add | fnb_bakery | Territory (add vs redistribute), Daypart |
| 4 | Coffee CBD daypart play | fnb_cafe | Daypart, Lease (CBD corridor) |
| 5 | Apparel mall unit | retail_apparel | Mall Intelligence, Lease |
| 6 | Pharmacy healthcare proximity | pharmacy | Healthcare, site-fit demand |
| 7 | Convenience white-space | convenience | White-Space, Territory |
| 8 | Fuel land & traffic | fuel | Land & Traffic, site-fit |
| 9 | Remittance footfall/network | remittance | White-Space, Territory |
| 10 | Fitness large-floorplate | services_fitness | Daypart, Lease, site-fit |

---

## The 3 gates every scenario must pass (3/3 to advance)

Applied per scenario, in order. A scenario is **PASS** only if all three are green; if a
gate fails, I fix the root cause (data or code), re-run, and only then advance.

### Gate A — Data sufficiency (accurate numbers?)
For this scenario's candidate(s): does site-fit get a real demand read (demographic cell
in range)? Does Territory find the right own-outlets? Does Lease resolve a corridor with
enough comps (≥5) to benchmark? **If thin → research + ingest real data into the Docker
Postgres via `db:populate` / curated loaders, then re-run.** No fabricated numbers — thin
data is filled with *researched real* data or honestly flagged Assumed.

### Gate B — Competitor relevance (Google Maps pulling the RIGHT businesses?)
The F&B core question. For this scenario, are the competitors Google returns *genuine*
competitors of this concept?
- **The fix I'll build:** a sub-category discriminator so a milk-tea concept competes with
  milk-tea/beverage shops — not every coffee shop or restaurant; a QSR competes with QSR/
  fast-food — not fine dining. Approach: (1) tighten `includedTypes` + add a `primaryType`/
  name allow-&-deny filter per sub-vertical (e.g. milk-tea allow `["cafe","coffee_shop"]`
  but require a beverage/tea name signal; QSR require `fast_food_restaurant`, exclude
  `fine_dining_restaurant`); (2) tag each competitor POI with a **sub-category** so the
  site-fit competition pillar counts only same-concept competitors within the zone.
- **Gate B passes** when the competitor set for the scenario is concept-relevant (spot-check
  + a relevance ratio), and the site-fit competition pillar reflects only true competitors.

### Gate C — Intake UX + result integrity (can a user actually do this, and is the output meaningful?)
- Every field this scenario needs exists, is correctly placed, and maps to a real result.
- **Existing Outlets gets a Google Map pin** — user drops/drags a pin (or searches) to set
  each outlet's exact location, instead of hoping an address geocodes. Same for candidate
  sites.
- The run produces a verdict + numbers that make sense for the scenario, with honest Truth
  Layers, and the report/scorecard read cleanly.
- **Gate C passes** when a user could complete this journey unaided and the output is
  correct and meaningful.

---

## Capture → tag → fix (how findings are recorded)

For every gate check I log a finding with a **tag**:
`[DATA-GAP]`, `[MAPS-RELEVANCE]`, `[LEASE-DATA]`, `[UI-INTAKE]`, `[UX-IMPROVE]`, `[CORRECTNESS]`
— each with severity (Blocker / Major / Minor), the scenario, and the fix applied. All land
in **`docs/QA_JOURNEY_FINDINGS_V2.md`** as a living log.

---

## Execution order

1. **Step 0** — strip pre-filled mock data (above). Verify app still builds + runs blank.
2. **Build the QA harness** — drives a scenario as a real user would: create franchisor →
   type outlets (with real geocodes) → candidate(s) → run pipeline → inspect every module +
   the UI field contract. Cleans up after itself.
3. **Scenario 1 → gates A/B/C.** Fix root causes (data research/ingest + code) until 3/3.
   The big cross-cutting fixes (F&B sub-category discriminator, demographic + lease data
   expansion, outlet map-pin) are built here since Scenario 1 hits them first, then reused.
4. **Scenarios 2–10**, each 3/3 before advancing. Later scenarios mostly validate the
   fixes from earlier ones + surface vertical-specific gaps (mall data, land/traffic, etc.).
5. **Final pass** — full test suite + build green; findings log finalized; all changed files
   + any new data delivered to `4 - Final Application`; Docker `db:populate` commands provided
   so you reproduce the exact dataset locally.

---

## Data research & ingestion (when a gate needs more data)

When Gate A or the lease question fails, I research real published figures and load them
into the Docker Postgres — never invent numbers:
- **Demographics:** expand `demographics.real.json` toward full NCR barangay coverage
  (real PSA populations + PSGC), lifting site-fit accuracy everywhere. → `db:populate`.
- **Lease comps:** add real corridor bands for the cities the scenarios hit that have none
  (Alabang, Mandaluyong, Manila, Marikina, etc.), grounded in published 2026 retail ranges.
- **Competitor typing:** refine the Places pull + re-tag POI sub-categories (code + re-pull).
All idempotent; each documented with the source and Truth Layer.

---

## What "done" looks like

- Pre-filled mock data removed; intake is a clean real-entry surface with map-pin outlets.
- 10/10 scenarios pass 3/3 gates.
- Google Maps returns concept-relevant competitors; F&B no longer conflicts in the zone.
- Data gaps found are filled with researched real data in the Docker DB (commands provided).
- Findings log (`QA_JOURNEY_FINDINGS_V2.md`) tags every issue + its fix.
- App is more user-friendly and retrieves the right data for meaningful results.

---

## Approval

Approve this plan to begin, or tell me what to adjust (scenario mix, the F&B relevance
approach, how aggressively to expand data, whether to keep any mock fallback). On approval
I start with Step 0, then Scenario 1 through its 3 gates.
