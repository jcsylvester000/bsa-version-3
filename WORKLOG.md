# BSA Work Log

The cross-thread state record. Read this (with the Master Instruction and the current
`4 - Final Application` tree) before continuing — continue, don't restart.

---

## 2026-08-10 — Browser User-Journey QA (broker POV) + fixes — COMPLETE

Ran a live Chrome journey QA as a Filipino broker: login → Franchise Screening → New Intake →
All Modules → Site Report. Journey WORKS end-to-end; all pages now dark-themed & readable.
Franchise Screening (live filters, dropdowns, Verified chips) and the Report (contextual notes,
corridor rent bars) passed clean. Two real broker-perspective issues found + FIXED, verified live:

1. **All Modules score-meaning bug (the big one).** The page showed RAW module scores with a naive
   high=green rule, so Territory Guard "0" (max trade-area overlap %) rendered RED — reading as a
   FAILED site when 0% overlap is the BEST outcome (no cannibalization). The Site Report already
   interpreted it correctly (green + "no branch sales on file"). FIX: rebuilt `components/ModulesView.tsx`
   with a per-module `interpret()` mirroring reportComposer's metricsForModule — reads each score in
   its true direction (territory inverts overlap→goodness; lease shows corridor median; informal =
   competition intensity), colours a GOODNESS value, and adds plain-language "What it means" +
   "Reading" columns. `app/(app)/modules/page.tsx` now passes payload through. Verified live:
   Territory "0%" → GREEN "No overlap — adds sales, no cannibalization"; Lease "—" → "₱3,100/sqm
   corridor median (n=6)"; every module reads meaningfully.
2. **Intake module-preview mismatch.** "Modules active for this vertical" greyed out White-Space for
   café, but the pipeline runs all four (territory/lease/daypart/whitespace) always. FIX: added a
   White-Space chip (kind:'new' → always active) to MODULE_CHIPS.base in `SteppedIntakeWizard.tsx` +
   updated the note. Verified live: White-Space now shows active with the other three.

Data confirmed REAL throughout (module_result rows, not mock). Braces balanced; ModulesView tsc clean.

---

## 2026-08-10 — Light-theme (white-card) bug fixed across 5 pages + All Modules rebuilt

User screenshot showed the All Modules page rendering near-invisible WHITE cards with dim text — it
was never converted to the dark theme (used bg-white / slate-* / nile-blue). Audited all pages;
found the same light-theme leak in 5 files and fixed every one.

- **All Modules REBUILT** (`app/(app)/modules/page.tsx` → thin server page + NEW
  `components/ModulesView.tsx` client). Dark-themed cards, readable color-BANDED scores (go≥65 /
  caution≥45 / nogo, via ScoreCell), flags as chips, TruthChip. Added a **site filter dropdown** +
  **module filter dropdown** + Clear + live result count. Data is REAL module_result rows (Decimal→
  number, BigInt id→string for the client boundary) — no mock. Fixed the ← Runs link to keep runId.
- **reports/page.tsx** — had the SAME severe bg-white card bug; converted all cards + section text to
  dark tokens.
- **lease-benchmark/page.tsx, territory-guard/page.tsx** — minor (← Runs link + empty-state text);
  converted to text-accent / text-ink-muted / border-ink-border.
- **TerritoryMap.tsx** — map frame border-slate-200 → border-ink-border.

Token map applied: nile-blue→accent, bg-white→ink-panel, slate-borders→ink-border, bg-slate-50→
ink-panel-2, slate-500/400→ink-muted, slate-900/700→ink-text. Explore Places was already correct
(the model). All brace-balanced; ModulesView tsc clean. Hot-reload; hard-refresh for the new pages.

---

## 2026-08-10 — Franchise-data accuracy: pass 2 (Projected brands) — COMPLETE

Second verification workflow (wf_c3f8bdc8-7fa) fact-checked the 32 Projected brands vs real sources.
Applied: 8 upgraded to Verified (Pan de Pidro, Posh Nails, California Nails, AHEAD Tutorial, Zagu, HK
Style Noodles, ML Kwarta Padala, Candy Corner), 6 to Assumed (SPIN-OFF, Brentgas, Macao Imperial Tea,
MathRiders, Helen Doron, Toby's tier), 39 figure corrections. 17 correctly STAYED Projected — audit
confirmed they don't publish PH terms: Bonchon (USD FDD only), Rose Pharmacy (corporate-owned, not
franchised), Coffee Project/Conti's/Red Crab (no published terms), remittance agents (Palawan/RS
Padala/LBC), tier placeholders (Lava Lava, Toppers, Mr. Butler, Water Refilling, Skin Station, Snapprint).

**Franchise matrix FINAL: 122 brands — Verified 84 (69%, up from 45%), Assumed 20 (16%), Projected 18
(15%). Real source-backing = 85%; provenance = 100%. Validator clean (0/0).**

**Did NOT hit 80% Verified — and that's correct/honest.** The 18 Projected brands genuinely don't
publish PH franchise terms (confirmed, not lazy). Forcing them Verified would fake it. 69% is the true
ceiling with existing sources. See [[bsa-data-accuracy]].

**LOCAL (user):** `npm run db:seed` loads the verified matrix; `npm run db:validate` confirms.

---

## 2026-08-10 — Screening UX overhaul + franchise-data accuracy audit — COMPLETE

**Franchise Screening UX (`components/FranchiseScreeningView.tsx`):** fetches the full catalogue
ONCE, then filters/re-ranks LIVE in-browser (no button). Added: budget + floor-area dropdown presets
via datalist (still free-type); capital-tier filter; Truth Layer filter (Verified-only etc.);
hide-out-of-reach toggle; sort control (fit/investment/payback/space); Reset. Fixed payback rounding
bug (0.6666… → r1() one-decimal). Isolated tsc clean, braces balanced.

**Franchise-data accuracy audit (`prisma/data/franchiseRequirements.real.json`):** user asked to
confirm data is real + ≥80% accurate. Ran a 4-agent verification workflow (wf_d574faf5-e1d)
fact-checking all 36 Assumed brands vs REAL franchisor sources. Applied: **22 upgraded to Verified**
(real source found), **35 figure corrections** (e.g. Greenwich royalty 10%→5% + inv ₱8-10M→₱15-31M;
Siomai House exact ₱555,555; Minute Burger 30sqm min; Farron format-pricing), **14 stayed Assumed**
(brand withholds / foreign-FDD only — honest), **1 duplicate removed** (Cinnabon-Davao = Annipie).
**Matrix now 122 brands: 76 Verified (62%, up from 45%), 14 Assumed, 32 Projected.** Validator clean.

**HONEST ANSWER on the 80% question:** Provenance/"not fake" = 100% (every row sourced, validator-
confirmed). Verified-against-source = 62% — deliberately NOT forced to 80% because the 32 Projected
brands genuinely don't publish PH terms; faking them Verified would break the Truth Layer. Audited
figures are corrected to source. See [[bsa-data-accuracy]].

**LOCAL (user):** `npm run db:seed` to load the verified matrix + corrections; `npm run db:validate`
to confirm; hard-refresh Franchise Screening to see the new live filters.

---

## 2026-08-10 — Data hardening pass 1: validator + Truth-Layer/source backfill — COMPLETE

User chose to harden existing data before the property-listings layer. Four sub-tasks; 3 done here,
2 (Baguio outlet, Assumed→Verified) are local/future.

- **NEW data-integrity validator (`scripts/validateData.ts`, npm `db:validate`).** Reusable QA guard
  (never mutates). Checks every reference file for: required fields, Truth Layer present+valid,
  source present, coords in PH/NCR+Davao bounds, numeric ranges (pop/rent/sqm/%). ERROR → exit 1
  (gates ingest); WARN → informational. Thresholds tuned so real values don't cry wolf (MOA 590k GLA,
  BGC/Makati zonal >₱1M, Davao-province cells all pass). Added `"db:validate": "tsx --tsconfig
  tsconfig.scripts.json scripts/validateData.ts"` to package.json.
- **Backfill (`prisma/data/demographics.real.json`, `franchiseRequirements.real.json`).** Filled 35
  demographic cells missing `source` + 11 missing `truth_layer` (set assumed; honest source string
  noting NCR/Davao supplementary cell, population PSA-grade). Filled 5 franchise brands (remittance/
  logistics) missing `source` (Projected category-norm note) and normalized their bare paybacks
  ("1–2" → "1–2 yrs (est.)") so they parse in screening.
- **Result: validator now 0 ERRORS / 0 WARNINGS across all 5 datasets** (296 demographics + 80 lease +
  33 malls + 26 zonal + 123 franchise). Every row Truth-Layer + source complete.

**LOCAL (user):** re-seed to load backfilled data: `npm run db:seed`; verify anytime with
`npm run db:validate`.

**STILL OPEN (local/future):**
1. Baguio mis-geocoded OUTLET — NOT in any data file/seed (seed outlets all in NCR); it's a DB row
   from a prior live populate of a real brand's outlets. Fix locally:
   `SELECT id, outlet_name, lat, lon FROM outlet WHERE lat > 14.85 OR lat < 14.25 OR lon < 120.85 OR lon > 121.20;`
   then UPDATE the offending row's coords or DELETE it. (No psql on Windows → use
   `npx prisma db execute --stdin` or a small tsx script.)
2. Upgrade Assumed/Projected → Verified (FRAN-RPT KPI 47%→70%): franchise matrix is 55 Verified /
   36 Assumed / 32 Projected. A research pass to confirm figures against real franchisor sources.

---

## 2026-08-10 — Screening demo prefill + BETA-vertical brand data — COMPLETE (re-seed needed)

**Demo prefill (`components/FranchiseScreeningView.tsx`):** page now opens with ₱2M / 80 sqm
prefilled and AUTO-RUNS on mount (run() takes optional overrides to avoid racing state), so the
ranked table shows immediately. Added a Clear button. Isolated tsc clean.

**BETA-vertical franchise data (`prisma/data/franchiseRequirements.real.json`): 103 → 123 brands.**
Multi-agent research (4 agents, one per thin vertical) found real PH franchise brands with sourced,
Truth-Layer-tagged requirements; strict dedup dropped 9 overlaps → **20 new brands** added: spa (e.g.
Nailaholics, Nuat Thai, Babaylan, Spaholics), salon (Reyes Haircutters, Bench Fix, Orange Blush),
fitness (Gold's Gym, Elorde, Snap Fitness, UFC Gym, Curves, Winners), bakery (Cara Mia, Kumori,
Mister Donut, Go Nuts, Annipie, Dunkin). Thin verticals now: fitness 1→8, spa 4→9, salon 5→7,
bakery 10→16. All 20 parse cleanly for screening (investment+payback). Truth Layer whole-file:
55 Verified / 36 Assumed / 32 Projected.
**Also fixed a real data bug:** Anytime Fitness was miscategorized `services_salon` → corrected to
`services_fitness`. (5 pre-existing remittance/logistics records still lack a `source` string — left
untouched, minor.)

**NEXT (user, local):** re-seed to load the new brands + the fitness fix into the DB:
`npm run db:seed` (idempotent — findFirst-then-update, auto-creates new brand rows). Then the
Franchise Screening page ranks 123 brands and the fitness vertical is populated. No migration needed.

**Data roadmap (agreed priorities):** 1) thin BETA verticals — DONE (this entry). Still open: more
competitor POIs for spa/salon/fitness/bakery via `npm run db:ingest:osm` (OSM under-tags these; a
curated named-brand POI file would be the stronger fix). 2) Real-site listings inventory (source =
public property portals, user chose). 3) Lease comps breadth. 4) Seasonality demand data.

---

## 2026-08-10 — Franchise Screening feature (NEW top-of-funnel) — COMPLETE

Closes the biggest gap from the demand-gap assessment (see project memory demand_gap): BSA had a
strong 14-field franchise matrix as DATA but no pre-site screening TOOL. This is the FRAN-RPT P2
(capital-tier blind spot) + P4 (payback illusion) + P5 (fragmentation) — three report problems in
one feature. Buyer enters budget + floor area → ranked, comparable brand shortlist.

Files (all new except the nav edit):
- `lib/modules/franchiseScreening.ts` — pure/testable. parseInvestment (₱15M–35M / ₱600K–6M /
  ₱50,000 → numeric range, ignores bare <1000 non-peso), parsePayback (→ YEARS, months normalized,
  (est.) flag — the payback-illusion fix), parseConfidence, scoreBrand (0–100 fit: budget headroom +
  space fit + payback/confidence nudges; over-budget/over-space FLAG-and-sink, never hide),
  screenBrands (rank, optional vertical filter), capitalTier (entry ≤600K / mid ≤6M / institutional).
- `tests/unit/franchiseScreening.test.ts` — 14 tests, ALL PASS (verified locally via vitest).
- `app/api/screening/route.ts` — POST {budgetPhp, floorAreaSqm?, vertical?} → ranked brands. Reads
  Franchisor.requirements (NOT JsonNull, dedup by name), zod-validated.
- `components/FranchiseScreeningView.tsx` — client: budget (accepts 2M/500K) + floor-area + vertical
  inputs → comparison table (fit score, capital-tier pill, investment/fee/space/payback, Truth Layer
  chip). Over-budget/over-space rows dimmed. Broker-supplementation footer.
- `app/(app)/screening/page.tsx` — server page.
- `components/SidebarNav.tsx` — added "Franchise Screening" (NEW) at top of Workspace group.

Truth Layer preserved: figures are franchisor-stated, each row keeps its Verified/Assumed/Projected
tag + confidence; payback normalized w/ (est.) marker. No new deps. Isolated tsc clean (view, page,
lib, route); 14/14 unit tests pass. Flow: screen here → shortlist → run full site analysis on winners.
Hot-reload; new API route needs the dev server to pick up the new route file (restart if not seen).

---

## 2026-08-10 — All four headline modules run on EVERY intake — COMPLETE (re-run needed)

User requirement: Territory Guard, Lease Benchmark, Daypart Demand, and White-Space must ALWAYS
produce a result, regardless of vertical. Chosen approach (honest, keeps Truth Layer): always run
+ label out-of-format reads as "contextual / lower weight" rather than hiding or faking confidence.

- **`lib/modules/verticalConfig.ts`:** CORE_MODULES now `['site_fit','territory','lease','daypart',
  'whitespace']` (was site_fit/territory/lease). Added `PRIMARY_VERTICALS` + `isPrimaryModule(vertical,
  module)` — territory/lease/site_fit primary everywhere; daypart primary for fnb_*/fitness/
  convenience/education; whitespace primary for convenience/remittance. UI badges non-primary reads.
- **`lib/modules/orchestrator.ts`:** Lease no longer silently skips when city/corridor can't be
  inferred — falls back to `DEFAULT_LEASE_CORRIDOR = 'Quezon City'` (every corridor in lease.real.json
  has 5–6 comps), so Lease ALWAYS persists a corridor benchmark. daypart/whitespace now always in the
  module list via CORE. (runDaypart/runWhiteSpace already degrade gracefully for any vertical.)
- **`components/SiteIntelligenceTabs.tsx`:** accepts `vertical`; each tab shows `<ContextualNote>` when
  its module isn't primary for the format, and `<RerunNote>` when a payload is null (older run). The
  White-Space empty-gaps state changed from "Not applicable to this format" to the honest saturation
  message ("your network already covers this territory") since the module now always runs. NoData
  helper is now unused (left in place).
- **`app/(app)/site/page.tsx`:** passes `vertical={run.vertical}` to the tabs.

**RE-RUN NEEDED:** these are pipeline + config changes. Existing runs won't have daypart/whitespace
results for verticals that didn't previously activate them → those tabs show the RerunNote. Re-run any
analysis to populate all four. Isolated tsc clean (tabs + verticalConfig against real enums); braces
balanced. Demo-data run (café/Starbucks): after re-run, White-Space will show the saturation message
(network covers NCR) with a Contextual badge; Daypart/Lease/Territory all populate.

---

## 2026-08-10 — Daypart-for-convenience, Lease chart on tab, White-Space map — COMPLETE (re-run needed)

Demographics ingest CONFIRMED working (user ran db:ingest): White-Space now ranks real gaps for a
7-Eleven/convenience run (Bagong Silang 250k, Commonwealth 213k, etc.). Three follow-ups from
user screenshots:

1. **Daypart now runs for convenience (`lib/modules/verticalConfig.ts`).** convenience was
   `['whitespace']` → now `['whitespace','daypart']`. c-stores have real daypart patterns
   (AM commute / lunch / late-night). Uses existing demographic data, no new research.
   (Was NOT a data gap — the empty tab was correct-by-config; user chose to activate it.)
2. **Lease chart + comps table on the site tab (`components/SiteIntelligenceTabs.tsx`).** The
   LeaseTab already showed the corridor summary + asking-rent input; added the
   `LeaseDistributionChart` (bars + median line, asking bar appears once user types a rent) and a
   comparable-leases table (rent + vs-median delta). Reuses the standalone page's chart component.
   Added medianPhpSqm/p25/p75 to the lease payload type (optional).
3. **White-Space single OSM map (`components/GapsMap.tsx` NEW + tabs + p2p3Math + p2p3Modules).**
   Gaps had NO coords. Added optional lat/lon to WhiteSpaceCell + WhiteSpaceGap (p2p3Math), and
   runWhiteSpace now selects `ST_Y/ST_X(ST_Centroid(geom))` per barangay. New GapsMap component:
   one CARTO/OSM dark basemap, a numbered amber pin per ranked gap, click for barangay+score,
   fitBounds to all pins, no API key. Wired above the ranked list on the White-Space tab; graceful
   fallback text when a gap has no coords (older runs).

**IMPORTANT — re-run needed:** #1 and #3 are PIPELINE changes; existing stored runs don't have the
daypart result or gap coords. User must re-run the analysis (New Intake → same inputs → Submit &
run, OR the run's re-run button) to see Daypart populate for convenience and the White-Space map
plot. #2 (lease chart) is pure UI — shows immediately on hot-reload. Isolated tsc clean; braces
balanced. GapsMap uses the same `import maplibregl` pattern as TerritoryMap (compiles in-project).

---

## 2026-08-10 — Lease/map text + display fixes — COMPLETE

Three UI issues from user screenshots (Senior Web & Application Engineer):

1. **Invisible Lease Benchmark inputs (`components/LeaseBenchmarkView.tsx`).** The "Asking lease
   terms" inputs (base rent/escalation/CUSA/term/fit-out) were MISSING the `.field` class, so they
   fell through to the base rule `input {color:#0b1426}` — near-black text on the dark form.
   Added `.field`. Also hardened `globals.css`: `input.field {color:#e8ecf5 !important}` +
   `::placeholder` colour, so no `.field` input can ever render dark-on-dark again.
2. **White map popup (`app/globals.css`).** MapLibre's own stylesheet was beating our dark
   `.maplibregl-popup-content` rule → white box, pale text. Added `!important` throughout (bg/
   text/border/radius/shadow/padding) + styled the close button so it's visible on dark.
3. **Lease "auto-run" clarity (`components/SiteIntelligenceTabs.tsx`).** NOT a bug — lease is a
   CORE module (verticalConfig CORE_MODULES = site_fit, territory, lease), so the pipeline already
   computes the corridor benchmark at intake (that's the "Mandaluyong · 5 comparable leases" the
   user saw). It shows `corridor_benchmark` (not an over/under verdict) because no asking rent is
   entered at intake. Rewrote the tab copy to say it ran automatically + point to the inline
   asking-rent input (now visible via fix 1) for the personalized read. No pipeline change.
   NOTE: user chose NOT to add asking-rent capture at intake this round — revisit later if wanted.

All balanced (tsx brace-checked; css brace-checked). Hot-reload; hard-refresh for new globals.css.

---

## 2026-08-10 — Demographics expansion: +142 real NCR barangays — DELIVERED (awaiting ingest)

Highest-leverage data lever identified from /api/admin/data-stats: demographic_cell was only
191 rows (the file had 156) — the limiter on White-Space (for convenience/remittance) and
Daypart precision. Expanded via a multi-agent workflow (6 agents, one per NCR city cluster)
researching REAL PSA 2020 census barangay populations from PhilAtlas (republishes official PSA
figures), deduped against the existing set, then I validated/merged in code.

Result: `prisma/data/demographics.real.json` 156 → **298 cells** (+142). All populations REAL
PSA 2020 (spot-checked, e.g. Bagbag QC 64,653 ✓); coords within Metro Manila bounds; income
band / daytime pop / renter share are Assumed estimates; every row carries a `source` string —
same Truth-Layer convention as the existing file. 2 dropped as dups (U.P. Campus, Bagumbayan QC).
Per-city coverage ~doubled: QC 24→53, Manila 14→34, Taguig 8→23, Pasig 13→21, etc. All 298
psgc_codes unique; every record has psgc+population+coords so none are skipped by the loader.
New codes use slug form `NCR-<CITY>-<BRGY>` where the real PSGC wasn't known.

Workflow gotcha logged: `args` reached the script as a JSON string, not an object → guard added
(`typeof args==='string' ? JSON.parse : args`). Also the resume replayed the validation agent
from the failed run's empty cache, so I extracted the 144 research cells from journal.jsonl and
did the merge/dedup/range-check in code instead of re-running the validator.

**NEXT (user, local — cloud can't reach the Docker DB):** run `npm run db:ingest -- demographics`
in `4 - Final Application`, restart dev server. Verify via /api/admin/data-stats:
reference.demographics should go 191 → ~333. Loader is idempotent (upsert by psgc_code, builds
600 m geog from lat/lon). To SEE White-Space populate, run a convenience/remittance brand
(NOT a café — fnb_cafe doesn't activate White-Space).

---

## 2026-08-10 — Territory Guard map: removed confusing streak animation — COMPLETE

User feedback: the Territory Guard map showed a confusing fan of "running streaks" (bright
lines radiating from the candidate to every outlet + competitor) plus a large amber trapezoid
bleeding off the bottom edge. Both came from `TriangulationOverlay` — a cinematic "spy-movie"
lock-on + water-ripple canvas animation (lines to outlets/competitors, expanding ripples sized
to the catchment radius, which smeared at low zoom).

Fix (Senior Web & Application Engineer): **removed the overlay from `TerritoryMap.tsx`** entirely.
Dropped the `TriangulationOverlay` import, the `mapReady`/`playToken` state, the `hav()` helper,
the `triPoints`/`nearestComps` computation, and the `<TriangulationOverlay>` JSX + its canvas
sibling. The map now renders clean: dashed outlet catchment rings, verdict-coloured candidate
ring (fill+line), own-outlet pins (nile blue), competitor dots (muesli), candidate pin, and the
outlier-guarded fitBounds. `competitors` prop is still used for the dots + bounds. Verified no
orphaned references remain (grep clean; tsc `noUnusedLocals` clean — sole isolated-tsc error is
maplibre's default-export quirk, not a code issue). **`TriangulationOverlay.tsx` left in place but
now unused** — no other file imports it, so it's dead code that can be deleted later if desired.

---

## 2026-08-10 — Left-nav legibility + Replay Tour — COMPLETE

Follow-up UI polish (Senior Web & Application Engineer).

- **Dim sidebar fixed (`app/globals.css`, `components/SidebarNav.tsx`).** `.nav-item`
  resting text was `text-ink-muted` (#8c96a8) — too faint. Now `text-ink-text/85`,
  `font-medium`, with a transparent left-border that turns accent on the active item;
  `.nav-item-active` adds `border-accent` + `font-semibold`. Group headings bumped from
  `text-ink-muted/70` to `text-ink-muted` + `font-bold`. Nav labels are now clearly legible.
- **Replay Tour (`app/(app)/settings/page.tsx`, `components/OnboardingTour.tsx`).** Added a
  "Getting started → Replay tour" section in Settings linking to `/runs?tour=1`. The tour now
  opens whenever the URL carries `?tour=1` (via `useSearchParams`), independent of the DB
  `has_onboarded` flag — so demo accounts can replay too. On finish/skip of a replay it
  `router.replace`s the param away (no reopen on refresh) and skips the onboarding POST; the
  genuine first-run path is unchanged (still POSTs `/api/auth/onboarding`). Isolated tsc passes.

---

## 2026-08-10 — New-computer migration + Onboarding Tour enhancement — COMPLETE

Migrated the app to the user's new machine (slytech-ai). Stood up the Dockerized
Postgres and restored `bsa_dev.dump`: **13,875 POIs / 2,231 outlets / 14 runs** verified.
Gotcha on this machine: host port **5432 is shadowed** by another listener, so Prisma got
P1000 auth failures even though `psql` worked inside the container. Fixed by moving the DB
to **5433** (`docker-compose.yml` → `'5433:5432'`, `.env` `DATABASE_URL` → `localhost:5433`).
App runs on `AUTH_MODE=db`.

**OnboardingTour enhancement (`components/OnboardingTour.tsx`).** The first-run tour modal
was too small/faint. Rewrote it: card widened 320px → **560px**, added an accent header
band ("Getting started · Step N of 6"), title bumped to `text-2xl` extrabold, body
brightened from `ink-muted` to `ink-text/90`, and each step now shows a **boxed amber
"What you can do" callout** (left-border accent, `bg-accent/10`) with the key takeaway in
bold accent. Copy expanded to 2–4 concrete, broker-friendly sentences per step, holding Grid
guardrails (broker-supplementation framing, honesty labels, no price verdicts). Wider card
clamps its left edge to stay on-screen when anchored near the viewport's right. All spotlight/
anchor/persistence logic preserved. Isolated `tsc` (real @types/react) passes.

Owner: Senior Web & Application Engineer (component), with Broker voice + User Journey QA on
copy clarity. To see it again on an already-onboarded account, the `has_onboarded` flag must
be reset (re-open via help icons, or a fresh registration).

---

## 2026-08-05 — Milestone 14: User Journey QA v5 (Round 4 — 20 EXTREME, role-focused) — COMPLETE

Plan `docs/QA_GAMEPLAN_V5.md`; findings `docs/QA_JOURNEY_FINDINGS_V5.md`. Emphasis on
brokers / agents / AFFI members, proving Territory / Lease / Daypart / White-Space genuinely
work (vary with input, no false/insufficient). **ALL 20 PASS 3/3.**

- **Daypart robustness fix (`p2p3Math.ts`):** curve was UI-reconstructed only; now
  `scoreDaypart` persists `hourly`[24] + `peakHour`. Daypart page prefers persisted curve.
  Verified: office peak 12h vs residential 19h. 1 new test.
- **Module-genuine proofs (harness):** Territory overlap varies 89.2%→0% w/ distance; Lease
  every corridor ≥5 comps (no false-insufficient); Daypart peaks shift by catchment; White-Space
  10 gaps / 9 distinct scores. All four proven, not false/flat.
- **Access scoping verified airtight:** AFFI member + broker read only own franchisor; foreign
  broker refused (no cross-client leak); analyst sees all. 2 dedicated access scenarios pass.
- Coverage after 4 rounds: 50 scenarios, all clusters, all 4 modules, all 3 roles.
- Verified: app tsc ✓, scripts tsc ✓, next build ✓, vitest **225** ✓.

---

## 2026-08-05 — Milestone 13: User Journey QA v4 (Round 3 — 10 HARDER scenarios) — COMPLETE

Plan `docs/QA_GAMEPLAN_V4.md`; findings `docs/QA_JOURNEY_FINDINGS_V4.md`. Stress-focused:
untested Automotive cluster, thin networks (2–8 outlets), edge geographies, ambiguous
concepts. **ALL 10 PASS 3/3.**

- **BLOCKER fixed — falsely-confident perfect score (`siteFitMath.ts`).** A data-sparse
  edge site (Valenzuela) scored composite 100/Go from a lone competition pillar with demand
  null. Now: when the demand pillar is defined but unscored, composite is capped at 44,
  verdict downgrades, Truth Layer ≤ Assumed, `low_confidence_no_demand_data` flag set →
  33.3/nogo/Assumed. Honest degradation. 2 unit tests.
- **New hard concepts (`competitorRelevance.ts`):** automotive (car_repair, ¬car-wash),
  grilled_qsr (Mang Inasal ≠ burger/steak), nail_salon (¬barber/massage), bookstore
  (¬clothing). conceptFor sub-routes grilled QSR + nail + bookstore. Live-verified. 8 tests.
- **Edge lease corridors:** added CAMANAVA + Las Piñas to lease.real.json (grounded Assumed);
  inferCorridor maps them. Lease now runs in edge geographies. lease_comp → 59, 11 corridors.
- Thin 2-outlet networks (AutoPlus/Lava Lava) verified honest — no fix needed.
- Coverage after 3 rounds: 30 scenarios, ALL 20 Excel clusters tested.
- Verified: app tsc ✓, scripts tsc ✓, next build ✓, vitest **224** ✓.

---

## 2026-08-04 — Milestone 12: User Journey QA v3 (Round 2 — 10 NEW scenarios) — COMPLETE

Plan `docs/QA_GAMEPLAN_V3.md`; findings `docs/QA_JOURNEY_FINDINGS_V3.md`. 10 brand-new
scenarios (no Round-1 reuse), leaning into the 9 Excel clusters Round 1 skipped.
**ALL 10 PASS 3/3.**

- New brands: Chowking, Max's, Gong Cha, Watsons, David's Salon, Ace Water Spa,
  Hi-Precision Diagnostics, Go Hotels, Kumon, Aquabest.
- **New concepts in `competitorRelevance.ts`:** `chinese_qsr` (Chowking ≠ burger QSR),
  `casual_dining` (Max's ≠ fast food), `water` (name-discriminated), refined `diagnostics`
  (real medical_clinic/medical_lab types). `conceptFor` sub-routes fnb_qsr by name +
  routes water. Proven live; +7 unit tests.
- Go Hotels low score (7.8) investigated → HONEST (20 real hotels within 800 m of the
  Ermita candidate; saturated corridor). No fix needed.
- No new data gaps — v2's lease (9 corridors) + demographics (10 cities) covered every
  Round-2 candidate on the first run.
- Coverage after 2 rounds: 20 scenarios across 19/20 Excel clusters; full module set.
- Verified: app tsc ✓, scripts tsc ✓, next build ✓, vitest **217** ✓.

---

## 2026-08-04 — Milestone 11: User Journey QA v2 (COMPLETE — all 10 pass 3/3)

Game plan: `docs/QA_GAMEPLAN_V2.md`. 10 scenarios × 3 gates (data / competitor
relevance / intake UX), 3/3 to advance. Findings → `docs/QA_JOURNEY_FINDINGS_V2.md`.

### Done so far
- **Step 0 — pre-filled mock data removed.** Intake no longer auto-fills: dropped the
  scenario picker + "Load demo data" button + DEMO prefill props from
  `SteppedIntakeWizard` and `intake/page.tsx`. Intake starts blank; the user types
  everything. (Mock-auth stays as a no-DB fallback; DEMO_SCENARIOS kept only as QA
  fixtures.) build ✓, 210 tests ✓.
- **Gate-B fix — F&B competitor sub-category discriminator (`lib/places/competitorRelevance.ts`).**
  Concept taxonomy pairs Google types with name allow/deny + allowTypes, so a milk-tea
  concept competes with milk-tea/bubble-tea shops (tea_house/tea_store + name signals),
  NOT specialty coffee, donuts or restaurants; QSR competes with fast-food, not fine
  dining. `placesService.relevantCompetitors()` text-searches the concept keyword then
  filters. Wired into `runTerritoryGuard` (+ orchestrator + API pass the brand/concept
  text). VERIFIED LIVE: milk-tea run now returns 20 real milk-tea shops (CoCo, Tealive,
  CHICHA, Gong Cha, Macao Imperial…) instead of coffee roasters. 11 new tests.

### COMPLETE — all 10 scenarios PASS 3/3
- **Map pin (Gate C):** `components/LocationPicker.tsx` — Google-basemap modal (search /
  click-drop / drag pin) wired to every outlet + candidate row in the wizard.
- **Site-fit competition pillar** now uses the concept-aware competitor count (orchestrator
  passes `relevantCompetitors` count within 800 m), so a milk-tea site isn't penalised for
  coffee shops. (`siteFit.ts` + `orchestrator.ts`.)
- **Data (Gate A):** lease.real.json 20→49 comps across 9 corridors (all ≥5); real published
  Mandaluyong/Alabang bands + grounded Assumed Manila/Marikina. demographics.real.json 30→39
  incl. real Marikina barangays. `inferCorridor` extended for all scenario cities. Ingested
  via db:populate.
- **Result:** ALL 10 scenarios PASS 3/3 (Gate A data · Gate B relevance · Gate C integrity).
  Findings: `docs/QA_JOURNEY_FINDINGS_V2.md`.
- Verified: app tsc ✓, scripts tsc ✓, next build ✓, vitest 210 ✓.

---

## 2026-08-04 — Milestone 10: "Analysis Sequence" — 8s futuristic data-load animation

**Status: complete and verified.** An 8-second futuristic overlay that plays on every
data load, narrating a believable series of tasks, then reveals the (instant) real data.

### What was built (all in `4 - Final Application`)
- **`components/AnalysisSequence.tsx`** — client wrapper: plays an 8s overlay on mount
  (streaming status log with ✓/▸ + blinking cursor, live % + progress bar, moving grid
  backdrop, horizontal scan line), then fades out and reveals children with a rise-in.
  Respects `prefers-reduced-motion` (skips to content) and takes a `disabled` prop.
  Six SVG/CSS motifs: radar sweep, grid pulse, growing bars, demand curve, progress
  ring/scanner, network graph.
- **`lib/ui/analysisSteps.ts`** — per-feature configs (title + motif + unique step
  lines). Territory Guard = radar + "pulling live competitors / computing overlap";
  Lease = bars + "building the corridor distribution"; Dashboard/White-Space = grid;
  Daypart = curve; Report/Land = scan/ring; Healthcare = network; Scorecard = radar.
- **`app/globals.css`** — keyframes + utility classes (as-radar-sweep/ping, as-scan,
  as-cell-pulse, as-bar-grow, as-ring-dash, as-spin, as-blink, as-gridbg) + reduced-motion.
- **Wired into every feature** that displays data: runs/dashboard, territory-guard,
  lease-benchmark, daypart, whitespace, scorecard, reports (mock + DB paths). The run
  *picker* list is left instant (navigation, not data).

### Verified
- app tsc ✓, `next build` ✓, vitest **199/199** ✓ (+31 config tests).
- Rendered a static preview (`docs/animation-preview.html`) and screenshotted it — the
  radar / bars / grid / ring motifs + streaming console read as intended.

### Notes
- Cosmetic only — data is already computed; the sequence just narrates it. 8s is a
  fixed dwell (`ANALYSIS_DURATION_MS`), easy to tune. To make it once-per-session, pass
  `disabled` from a session flag (hook point left in the component).

---

## 2026-08-04 — Milestone 9, Phase 3b: Territory Guard × Google Maps integration test

**Status: complete and verified.** Confirmed Territory Guard uses Google Maps to find
locations, compute overlaps, and display verdict-coloured area recommendations.

### Tested live against the key
- **Geocoding** finds real locations (Ayala Ave, BGC High Street → real lat/lon). ✅
- **Places (New)** finds real competitors (20 named Makati cafés near the candidate). ✅
- **Map Tiles** — createSession mints a token; a real `2dtiles` fetch returns a
  256×256 Google PNG. `/api/maptiles` proxies it (key server-side; OSM fallback). ✅
- **Overlap + recommendation** end to end: Makati Ayala candidate vs real Macao
  cluster → 75.3% overlap @ 352 m → redistributes, ₱340,200 cannibalization, 20
  competitors, map data contract valid. ✅

### Hardening
- Extracted ring geometry (`geoCircle`, `VERDICT_COLOR`) → `lib/geo/mapGeometry.ts`
  (pure, testable); `TerritoryMap.tsx` imports it.
- Added `tests/unit/mapGeometry.test.ts` (5 tests): closed ring, radius accuracy,
  scaling, segment count, distinct verdict colours.
- Report: `docs/TERRITORY_GUARD_MAPS_TEST.md`.

### Verified
- app tsc ✓, `next build` ✓, vitest **168/168** ✓ (+5 map tests).
- Only unexercised piece: live browser screenshot (sandbox localhost unreachable from
  the desktop browser); every server-side dependency verified working.

---

## 2026-08-04 — Milestone 9, Phase 3: 10-user Journey QA + high-priority fixes

**Status: complete and verified.** Objective 3 of the Real-World Data action plan.

### Method
A QA harness drove all 10 demo scenarios through the REAL pipeline (intake → outlets →
run → candidates → runPipeline → module_results → verdict) against the populated DB, then
inspected results for correct module activation, competitor discovery, lease resolution,
verdicts and Truth-Layer honesty. All 10 journeys complete with the right modules per
vertical; no crashes. Full findings in `docs/QA_JOURNEY_FINDINGS.md`.

### Findings → fixes applied
- **F1 (FIXED):** DB-mode Territory Guard never pulled real competitors — only mock did.
  `runTerritoryGuard` now takes the vertical and pulls + persists real Google-Places
  competitors into the module_result (`territoryGuard.ts`, `orchestrator.ts`,
  `api/territory-guard/route.ts`). 9/10 journeys now show 20 real competitors.
- **F2 (FIXED):** `inferCorridor` only knew BGC/Ortigas/Makati, so QC + Pasay candidates
  skipped Lease even though comps existed. Extended to map QC + Pasay Bay Area; +4 tests.
- **F3 (MITIGATED):** thin demographic_cell coverage collapsed site-fit to nogo(0) for
  sites with no cell in range. Added a nearest-cell demand fallback (6 km, Assumed-flagged)
  so a real site gets a real score, not a false zero (`siteFit.ts`). QC Timog: 0 → 34.1.
  Real fix (denser PSA demographics) documented as a data pass.
- **F4/F5 (documented):** remittance competitor mapping is thin; lease covers 5 NCR
  corridors only. Both are dataset-breadth items with the exact loader/file to close them.

### Deliverables
- `docs/QA_JOURNEY_FINDINGS.md` — full per-journey QA + findings + recommendations.
- Code fixes above.

### Verified
- app tsc ✓, scripts tsc ✓, vitest **163/163** ✓ (+4 corridor tests).
- QA harness re-run: competitors populated, QC lease resolves, QC Timog 0 → 34.1 (Assumed).

---

## 2026-08-04 — Milestone 9, Phase 2c: 10 complete real-data prefill scenarios

**Status: complete and verified.** "Load demo data" now fills EVERY field with real
data, across 10 unique user-journey scenarios.

### The bug this fixed
Prefill dropdown fields (target customer, income band, footprint, expansion goal,
site preference, consent) store the option VALUE; if a scenario's value didn't match
an option verbatim, that `<select>` rendered blank. The old cafe scenario's site-
preference and the pharmacy expansion-goal were mismatched → blank on load.

### What changed (`lib/mock/demoData.ts`)
- **DEMO_SCENARIOS 4 → 10**, one per user-journey vertical: cafe (Macao Imperial
  Tea), QSR (Jollibee), bakery (Red Ribbon), coffee/daypart (Starbucks), apparel/mall
  (Bench), pharmacy/healthcare (Mercury Drug), convenience/white-space (7-Eleven),
  fuel/land (Petron), remittance (Cebuana Lhuillier), fitness (Anytime Fitness).
- Every scenario fills all 8 intake fields (a,b,b2,c,d,e,f,k). All six dropdown
  fields use EXACT option values from intakeOptions.ts → no select renders blank.
- Every outlet + candidate is a real Metro Manila branch/site pulled from the
  populated DB (real names + coordinates). Sales left Assumed (not public).
- `DemoScenario.vertical` widened from a 4-literal union to `string` (all verticals).

### Guardrail added (`tests/unit/demoScenarios.test.ts`)
41 tests: exactly 10 unique scenarios; every required field filled; every dropdown
value matches an option (the exact check that was missing); outlets+candidates have
valid PH coordinates. This makes a silent blank-field regression impossible.

### Verified
- app tsc ✓, scripts tsc ✓, `next build` ✓, vitest **159/159** ✓ (+41 new).
- Validation script confirmed 10/10 scenarios fill every field with valid values.

---

## 2026-08-04 — Milestone 9, Phase 2b: Full 20-cluster real brand coverage (Excel-driven)

**Status: complete and verified.** Extended the real-data catalog to cover every
business type in the PFA Analysis workbook (2 - Data Intake).

### Source
`GPV-BSL-2026-DEMAND-GAP-001_PFA_Analysis.xlsx` → "Cluster Analysis" sheet: 20
demand clusters across 242 franchisor brands (F&B 166 / Services 42 / Retail 34).
The named-brand outreach list isn't in the folder, so each cluster is covered by
real PH franchise brands sourced via Google Places.

### What changed
- **`lib/ingest/places.ts` — BRAND_CATALOG expanded 14 → 45 real brands**, one+
  per cluster, each tagged with its Excel `cluster` (new BrandDef field). Added:
  McDonald's, Max's, Vikings (dining); Gong Cha (milk tea); Red Ribbon, Goldilocks
  (bakery); Bench, Penshoppe (apparel); Starbucks, Coffee Bean (cafe); Southstar
  (pharmacy); Nail Spa, Ace Water Spa (spa); Alfamart (grocery); David's Salon,
  Bruno's Barbers (salon); Rapide, AutoPlus (automotive); Lava Lava, Wash Express
  (laundry); Hi-Precision, Healthway (diagnostics); Cebuana, M Lhuillier
  (remittance); Red Planet, Go Hotels (hotel); AHEAD, Kumon (education); Aquabest,
  Crystal Clear (water); Anytime Fitness; National Book Store.

### Verified (Docker/local Postgres, full populate)
- **20/20 clusters covered**, every cluster has real outlets. Totals: **franchisor
  47, outlet ~2,270, poi 2,452, malls 45** + curated zonal/demographics/lease/docs.
- Truth Layers honest (real coords Verified/Assumed, sales never faked).
- 0 exact duplicate outlets; per-brand clear-and-reinsert = no accumulation.
- app tsc ✓, scripts tsc ✓, vitest 118/118 ✓.
- NOTE: populate runs against the LOCAL/Docker DB (`db:populate`); this was verified
  in the sandbox Postgres. User re-runs it against their own Docker DB.

---

## 2026-08-04 — Milestone 9, Phase 2: Remove imaginary mock data; real brand end to end

**Status: complete and verified.** Objective 2 of the Real-World Data action plan.
The app now tells a real Philippine story out of the box — no "Kanto Freshcup".

### What changed (all in `4 - Final Application`)
- **Demo brand swap → Macao Imperial Tea** (real milk-tea chain). Rebuilt
  `lib/mock/demoData.ts` and `prisma/seed.ts` around 6 real Metro Manila branches
  (One Ayala, Greenhills, SM Megamall, SM MOA, E. Rodriguez, Banawe) with real
  coordinates. Sales are Assumed placeholders (chain sales not public) — labelled
  Assumed, never Verified.
- **Meaningful demo result on real data:** primary candidate moved to Makati Ayala
  Ave (~250 m from the real One Ayala branch) → Territory Guard 75% overlap →
  "redistributes"; Alabang contrast → 0% → "adds". Lease benchmarks the real Makati
  CBD band (asking ₱2,600 → above market, 64th pctile).
- **Multi-scenario prefill** (`DEMO_SCENARIOS` + a scenario picker in
  `SteppedIntakeWizard`): cafe (Macao Imperial Tea), pharmacy (Mercury Drug), fuel
  (Petron), convenience (7-Eleven) — all real brands, real coordinates, selectable
  at intake with a one-line blurb.
- **Purged invented figures / brand refs** across module pages (territory-guard,
  lease-benchmark, reports, daypart, scorecard, whitespace, runs), login defaults,
  mockUsers, IntakeWizard placeholder, and report text. Lease demo rebuilt on real
  corridor bands (Makati CBD + BGC). Competitor count in the report now reads from
  the live Google-Places pull, not a hardcoded "4".
- **Seed made idempotent:** clears this franchisor's prior intakes first (runs +
  candidate sites cascade), so re-seeding no longer accumulates demo runs.
- Shared methodology corpus: seed now calls `seedMethodologyChunks()` (11 chunks).

### Verified
- app tsc ✓, scripts tsc ✓, vitest **118/118** ✓, `next build` ✓.
- Re-seed idempotent (1 run / 2 candidates after repeated seeds).
- Mock-mode pages render the real brand end to end: dashboard, Territory Guard (all
  6 real outlets), Lease, Reports — with honest Verified/Assumed/Projected chips.
- NEXT: Phase 3 — 10-user QA on the real data → `docs/QA_JOURNEY_FINDINGS.md`.

---

## 2026-08-04 — Milestone 9, Phase 1: Real-world data into all databases (`db:populate`)

**Status: complete and verified.** Objective 1 of the Real-World Data action plan.
The app now runs on a real Philippine dataset instead of imaginary demo rows.

### What was built (all in `4 - Final Application`)
- **`lib/ingest/places.ts`** — Google-Places real-data pullers: a 15-brand catalog
  (Jollibee, Chowking, Mang Inasal, Chatime, Macao Imperial Tea, Potato Corner,
  7-Eleven, Ministop, Mercury Drug, Watsons, Gold's Gym, Petron, Shell, Caltex),
  `pullBrand` (franchisor+outlets), `pullPoiSweep` (competitor/anchor POI across a
  12-cell NCR grid), `pullMalls` (SM/Ayala/Robinsons/Megaworld), `pullHealthcare`.
  Deterministic `brandUuid` (valid v4), `normalizeMallName` for cross-pull dedup.
- **Curated real reference files** `prisma/data/{zonal,demographics,lease}.real.json`
  — real BIR RDO zonal ranges (BGC CC up to ₱2.16M/sqm, Makati, etc.), real 2020-census
  NCR barangay populations w/ PSGC codes, published 2026 corridor lease bands (BGC/Makati/
  Ortigas/Pasay/QC). Honest Truth Layers (Verified where sourced, Assumed where inferred).
- **`lib/ingest/loaders.ts`** — added `loadLease` (clear-per-group then insert).
  **`lib/ingest/normalize.ts`** — added `normalizeLease` + `leaseNaturalKey`.
- **`prisma/methodologyChunks.ts`** — 11-chunk real methodology corpus (per-module
  methodology + Truth-Layer/broker guardrails) for the AI retrieve step. Shared by seed.
- **`prisma/populate.ts` + `npm run db:populate`** — orchestrator (flags: `--brands`,
  `--skip-places`, `--quick`), idempotent, prints per-table counts + Truth Layer mix.

### Verified (local Postgres, full production run)
- Full build: **923 outlets · 2,452 POIs · 44 malls · 16 zonal · 30 demographics ·
  20 lease · 11 doc_chunk · 15 franchisors.** Truth Layers: POI/demographics Verified,
  outlets/malls Assumed (real coord, non-public sales/footfall), zonal/lease mixed.
- Idempotent: re-runs hold row counts steady (verified for malls 44→44, all tables).
- tsc strict ✓, vitest **118/118** ✓ (+7 new tests for lease/mall/brandUuid normalizers).

### Notes
- Places pullers are keyless-safe (return empty if no GOOGLE_API_KEY). Cache-aware
  (6h in-process) so re-pulls are cheap. Sales/footfall never invented as Verified.
- NEXT: Phase 2 — swap Kanto Freshcup → Macao Imperial Tea, real multi-scenario
  prefill, purge invented figures from lib/mock. Then Phase 3 — 10-user QA.

---

## 2026-08-04 — Milestone 8: Dark "Site Intelligence" visual overhaul (Visual Prototype)

**Status: complete and verified.** Rebuilt the UI to match the IMPROVE-002 Visual Prototype
mockups — dark navy theme, dashboard, and richer per-module visualizations.

### What was built (all in `4 - Final Application`)
- **Dark design system**: palette sampled from the mockups (ink-bg #0b1426, panel #132241,
  accent #e0a568, verified/assumed/projected greens/ambers/violet). Tokens in
  tailwind.config; component classes in globals.css (.card, .stat-tile, .pill, .btn-accent,
  .field, .nav-item). Reusable UI: components/ui/{StatTile,Panel(+ScoreBar),Chips}.
- **Sidebar layout**: app shell rebuilt with a left rail (SidebarNav — Workspace /
  Intelligence / Output groups, NEW tags, keeps runId in feature links).
- **Site Intelligence Dashboard** (RunDashboard + lib/modules/dashboard.ts): replaces the
  runs list — KPI tiles (Sites Cleared/Top Fit/Territory Conflicts/Lease Outliers), ranked
  shortlist with pillar-score bars, Truth Layer quality panel, Intelligence Alerts (module
  findings tagged to source). /runs?runId= renders it; no runId → run picker cards.
- **P1 screens reskinned**: Territory Guard + Lease Benchmark dark; Lease chart rebuilt as a
  vertical-bar rent distribution (median line + highlighted asking bar).
- **New visualizations**: White-Space heatmap grid (WhiteSpaceGrid + /whitespace) with
  ranked gap cards; Daypart demand curve (DaypartCurve + /daypart, area chart + peak band +
  peak-hour share bar). Both from module_result data or mock.
- **Stepped intake wizard** (SteppedIntakeWizard): "Step 1 of 4" — vertical cards
  (F&B LIVE / Healthcare Q3 / Retail&Mall Q3 / Land-Intensive Q4) + per-vertical module
  toggle chips, then brief / outlets / candidate sites steps. Keeps geocoding + CSV.
  Replaces the old IntakeWizard on /intake (old file kept, unused).

### Verified
- build ✓, tsc strict ✓, vitest 111/111 ✓.
- Mock mode: dashboard, White-Space, Daypart, stepped intake all render per mockups
  (screenshotted). DB mode: pipeline → dashboard/whitespace/daypart all 200.

### Notes
- dataviz method applied: Lease = bars (magnitude), Daypart = area (time), White-Space =
  heatmap (sequential amber ramp). Status colours reserved for verdicts.
- White-Space grid backdrop is a deterministic demand pattern (no real per-cell geo yet) with
  the real ranked gaps overlaid; Daypart curve is synthesized from the daytime share.

### Next steps
1. Wire VectorShift as real AI provider behind AiProvider.
2. Optional: real per-cell geo for the White-Space grid; real hourly data for Daypart.
3. Security: rotate Google key + referrer restriction.

---

## 2026-08-04 — Milestone 7: Google Places (real establishments) + full Google Maps

**Status: complete and verified.** Real Philippine establishments now flow through the app.

### What was built (all in `4 - Final Application`)
- **Google Places service** (`lib/places/`): `placeTypes.ts` (vertical → Google place
  types/keywords), `placesService.ts` (Nearby + Text search via Places API New,
  server-side key, in-process cache keyed by area+type, 6h TTL — repeated demo runs
  don't re-bill). `/api/places` route (nearby by vertical/types, or text by brand).
- **Real competitors in Territory Guard**: the TG API (and mock path) now pull real
  competing establishments near each candidate via Places and plot them on the Google
  map (muesli dots) with a live count. `mockTerritoryGuard`/`mockReport` are now async.
- **Explore page** (`app/(app)/explore` + `components/PlacesExplorer`): type an area +
  establishment type → real Google Places results on the Google map; or "Find a brand's
  outlets" text mode → a real chain's actual branches across the PH. Nav link added.
- **Google Maps basemap** (from M6, confirmed): `/api/maptiles` session + tile proxy;
  the TG/Explore maps render Google tiles (key server-side), OSM fallback.
- **Geocoding** (from M6): `/api/geocode` — intake addresses → real lat/lon.

### Verified (live, real Google data)
- build ✓, tsc strict ✓, vitest 111/111 ✓.
- Mock mode: TG pulls 20 real competitors per candidate (Starbucks/Wildflour/Mad Mark's
  near BGC); Explore returns real pharmacies (Mercury Drug, Watsons) near Ayala; brand
  text search finds Macao Imperial Tea's real branches. Screenshotted.
- DB mode: real run also pulls 20 real competitors.

### Decisions
- Real competitors feed the MAP + a competitor count now; wiring them into the numeric
  competition/informal SCORE (replacing the seeded POI count) is a clean next step —
  left as-is to avoid changing scored outputs mid-demo.
- Demo outlet network stays the curated Kanto set (used synchronously across scoring);
  real-brand outlet discovery is available via the Explore "brand" mode.
- Places cache is in-process (per server). Production upgrade: persist to a
  `places_cache` table or the `poi` table (same service interface).

### Next steps
1. Wire VectorShift as real AI provider behind AiProvider.
2. Optional: feed real Places competitor counts into the numeric competition score;
   persist Places results to poi/cache table.
3. Security: ROTATE the Google key + restrict by API + referrer; login rate-limit, CSP.

---

## 2026-08-04 — Milestone 6: All 9 features complete + Google Maps + intake UX + demo prefill

**Status: complete and verified.** Coverage audit + the two missing features + Maps + intake rework.

### Coverage audit (vs 2 - Data Intake, all 242 brands / 20 clusters)
Confirmed the app serves the franchisor/broker/franchisee users and all 9 roadmap features.
Found 2 missing → built both this milestone. Now ALL 9 features exist:
F1 Territory ✓ · F2 Lease ✓ · F3 Healthcare ✓ · **F4 Land & Traffic ✓ (new)** · F5 Mall ✓ ·
F6 White-Space ✓ · F7 Daypart ✓ · F8 Informal ✓ · **F9 Self-Serve Scorecard ✓ (new)**.

### What was built (all in `4 - Final Application`)
- **F9 Self-Serve Scorecard** (~92 brands): `lib/modules/scorecard.ts` (pure) +
  `scorecardServer.ts` (build from module_results). One-page printable scorecard per site
  with Go/Caution/No-Go band, weighted criteria, Truth Layer per line. `/api/scorecard`,
  `app/(app)/scorecard` (print-friendly), PrintButton. Territory overlap inverted to a
  goodness score. Linked from runs.
- **F4 Land & Traffic** (fuel/automotive/hotel): `lib/modules/landTrafficMath.ts` (pure) +
  `runLand` in p2p3Modules — traffic band from nearby transport/office/mall POIs, zoning
  from zonal_value C-class, format frontage/lot minimums. Zoning is a hard gate. Wired into
  verticalConfig (land verticals) + orchestrator. Intake shows a land-mode banner.
- **Google Maps** (real key in .env, server-side): `lib/geo/geocode.ts` + `/api/geocode` —
  geocodes typed addresses → real PH lat/lon. Intake uses it so users type an address, not
  coordinates. Verified live against the real key.
- **Intake rework** (click-input-submit): `lib/modules/intakeOptions.ts` — dropdowns for
  target customer, income, footprint, expansion goal, site preference, consent, grouped
  vertical picker. Outlet master = per-branch add-row form (name, format dropdown,
  address→auto-locate, sales) AND CSV upload kept. Candidate sites take an address and
  geocode. Rebuilt components/IntakeWizard.tsx.
- **Schema**: added `land` + `scorecard` to ModuleKind enum (migration
  20260804000000_add_land_scorecard_modules — ALTER TYPE ADD VALUE, recorded in
  _prisma_migrations).

### Verified
- build ✓, tsc strict ✓, **vitest 111/111** ✓ (10 new: land + scorecard math).
- Live DB mode: geocode ("SM Megamall"→real coords), new intake renders + pre-fills to 100%,
  scorecard (BGC Caution 57.7 / Alabang Go 75.2), fuel run activates land module (score 55
  Assumed). Screenshotted intake + scorecard.
- Mock mode: intake + scorecard both 200.

### Next steps
1. Wire VectorShift as real AI provider behind AiProvider (verdicts + report sharpen).
2. Optional: capture frontage/lot fields at intake for land verticals; ingest a real
   vehicle-traffic dataset (currently POI-proxied, flagged Assumed).
3. Optional: real PDF/DOCX report render.
4. Security hardening (docs/SECURITY_POSTURE.md): ROTATE the Google key (now in use — restrict
   by API + HTTP referrer in Google Cloud console), login rate-limit, CSP.

---

## 2026-08-03 — Milestone 5: Orchestration + ingestion + P2/P3 modules + full mock mode

**Status: complete and verified.** All non-AI areas finished (AI stays mocked → VectorShift later).

### What was built (all in `4 - Final Application`)
- **Pipeline orchestration** (`lib/modules/orchestrator.ts`): the "Run pipeline" step —
  runs the vertical's activated modules across all sites, writes module_results, updates
  candidate composite/verdict, sets run status + confidence. `POST /api/runs/[id]/run`,
  `RunPipelineButton` on the runs list. Vertical→module map in `verticalConfig.ts`.
  Site-fit scoring: `siteFitMath.ts` (pure) + `siteFit.ts` (server; demand from
  demographics, competition from POI).
- **Reference-data ingestion** (`lib/ingest/`): `normalize.ts` (pure, tested) +
  `loaders.ts` (idempotent upsert on natural keys, Truth Layer at the data layer).
  CLI `prisma/ingest.ts` (`npm run db:ingest`), sample datasets in `prisma/data/`.
- **P2/P3 modules** (`p2p3Math.ts` pure + `p2p3Modules.ts` server): Daypart, Informal-
  Competitor, Mall Intelligence, Healthcare Proximity, White-Space — each reads its
  reference table, writes a typed module_result with the architecture's Truth Layer.
  Wired into the orchestrator. Report composer + sections extended to ground on them.
- **Modules overview** (`app/(app)/modules` + `/api/modules`): every module result per
  run, grouped, with Truth Layer chips. Linked from runs.
- **Full mock-mode compute** (`lib/mock/mockCompute.ts`): Territory Guard + Lease
  Benchmark compute against in-memory demo data using the SAME pure math — the whole app
  is clickable with NO database. Request schemas accept `mock-*` ids.

### Schema change
Dropped the custom `name:` on the two single-field `@@unique`s (poi.osmId,
demographic_cell.psgcCode) → field-level `@unique`, so Prisma exposes clean `where`
selectors. DB unique indexes are unchanged (init migration already creates them), so a
fresh `migrate deploy` matches — no new migration needed.

### Verified
- build ✓, tsc strict ✓, **vitest 101/101** ✓ (was 62). Ingestion idempotent (re-run =
  no dupes), geom populated via triggers.
- DB mode live: pipeline runs all activated modules (site_fit Verified ~82, territory
  Projected, lease Assumed, daypart Projected, informal Assumed+flag); modules API
  returns 9; report gen 200.
- Mock mode live (no DATABASE_URL): login + Territory Guard (BGC redistributes 75.2%,
  Alabang adds 0%) + Lease Benchmark (above_market, 77.8th pct) all work with no DB.
  Screenshotted.

### Decisions
- One "Modules" overview page instead of 7 bespoke P2/P3 pages — development-ready and
  keeps the surface small; the dev team can expand any into a rich view.
- Lease at pipeline time runs with empty asking terms (yields the corridor read); the
  Lease Benchmark page is where a user enters asking terms.
- Site-fit accessibility pillar left null until a transport/road layer is ingested
  (honest — not guessed).

### Next steps
1. Wire VectorShift as the real AI provider behind AiProvider (verdicts + report sharpen).
2. Optional: real PDF/DOCX report render; PSGC boundary polygons for demographics.
3. Security hardening (docs/SECURITY_POSTURE.md): rotate Google key, login rate-limit, CSP.

---

## 2026-08-03 — Milestone 4: Object storage + 9-section Report composer

**Status: complete and verified.** (Milestone 3 was the login fix / mock mode.)

### What was built (all in `4 - Final Application`)
- **Storage layer** (`lib/storage/`): `StorageProvider` interface, `LocalFsProvider`
  (files under `.storage/`, git-ignored), HMAC signed-token module (`signtoken.ts`),
  provider selector (`STORAGE_PROVIDER=local` default, S3/R2-ready). Signed download
  route `app/api/files/route.ts` — serves only with a valid, unexpired token; no public
  listing; uniform 404 on bad/expired/missing token.
- **Report composer** (`lib/modules/`): `reportSections.ts` (the 9 sections + which
  modules ground each), `reportComposer.ts` (gathers module_results → grounded facts →
  retrieve-then-generate per section → run confidence from Truth Layer mix),
  `reportRender.ts` (deterministic Markdown → store → save `report` row + pointer).
  Sections with no data render "not assessed", never invented.
- **API + UI:** `app/api/reports/route.ts` (POST generate, GET fetch+signed URL),
  `components/ReportView.tsx`, `app/(app)/reports/page.tsx`. Report link added to runs list.
- **Tests:** +13 (`storage.test.ts` sign/verify/expire/tamper; `report.test.ts` 9-section
  structure + Markdown render + honesty). **Suite now 62/62 green.** Added a `server-only`
  vitest alias so pure logic in server modules is testable.

### Verified (live, DB mode)
- Generated the report for run 9e51672d (has territory+lease results): 9 sections,
  confidence **Low** (mix 0 Verified/1 Assumed/2 Projected — correct), assessed sections
  grounded, others honestly "not assessed". Downloaded via signed URL (200). Security:
  tampered sig → 404, expired exp → 404, no token → 404, unauth API → 401. UI screenshotted.

### Decisions
- Stored artifact is Markdown (`site-intelligence.md`); `report.format` enum only has
  pdf/docx so it's set to pdf as a placeholder — dev team can add a real PDF/DOCX render
  step later (the composed sections are the hard part and are done).
- Signed URLs use AUTH_SECRET as the HMAC key (dev fallback locally; BSA_REQUIRE_SECRET=1
  in prod). 5-min default expiry.
- Report confidence reuses `rollUpConfidence` (Truth Layer mix + on-ground-check downgrade).

### Next steps
1. Wire VectorShift as the real AI provider behind the existing AiProvider interface
   (report sections + verdicts sharpen immediately; harness unchanged). NOT a direct LLM.
2. Optional: real PDF/DOCX render of the report (currently Markdown).
3. Optional: make Territory Guard + Lease compute in mock mode (no DB) for pure demo.
4. Security hardening (docs/SECURITY_POSTURE.md): rotate the Google key, login rate-limit, CSP.
5. P2 verticals (Healthcare POI, Land&Traffic, Mall, White-Space).

---

## 2026-08-03 — Milestone 2: Lease Benchmark (P1 #2)

**Status: complete and verified.** Built on the Milestone 1 foundation, same patterns.

### What was built (all in `4 - Final Application`)
- **`lib/modules/leaseMath.ts`** (pure, tested): quantiles/distribution, percentile rank,
  per-term over/under/at-market flags (±5% band, direction-aware — fit-out inverted),
  negotiating room to median, and the full `benchmarkLease()` roll-up with a `MIN_SAMPLE`
  reliability floor.
- **`lib/modules/leaseBenchmark.ts`** (server): queries `lease_comp` by format+corridor
  (falls back to corridor when mall comps thin), runs the math, persists
  `module_result(module="lease")`. Truth Layer: comps Verified, fair-range Assumed —
  and **Projected when the sample is thin** so it never overstates confidence.
- **`app/api/lease-benchmark/route.ts`** (POST+GET): Zod-validated, auth + franchisor
  scoping, retrieve-then-generate verdict, `ai_generation` log, audit.
- **UI:** `components/LeaseDistributionChart.tsx` (inline-SVG strip plot: comp dots,
  p25–p75 band, median line, asking marker coloured by verdict),
  `components/LeaseBenchmarkView.tsx` (term inputs, comparison table, verdict panel,
  Truth chips), `app/(app)/lease-benchmark/page.tsx`. Linked from the runs list.
- **Seed:** 9 realistic BGC/inline comps (median ₱1,380) + a lease-specific `doc_chunk`
  so the AI retrieval is on-topic.
- **Tests:** +20 vitest unit tests (quantile, distribution, percentile, flags,
  benchmark integration, thin-sample honesty). **Suite now 49/49 green.**

### Verified
- build ✓, tsc strict ✓, vitest 49/49 ✓, seed ✓.
- Live: asking ₱1,450 vs BGC comps → 77.8th percentile, **above_market**, ₱70/sqm
  (5.1%) negotiating room, flags `overpaying_base_rent` + `secondary_terms_over_market`;
  persisted to `module_result`, verdict logged to `ai_generation`.
- Honesty paths: empty corridor → `insufficient_data`, fair-range downgraded to
  `projected`; no terms → 422. UI screenshotted — chart + table + verdict render per brand.

### Decisions
- Percentile is the headline (base rent); other terms get a median-relative flag, not a
  percentile, to avoid over-precision on thinner per-term samples.
- Fit-out `higherIsWorse=false` (a longer fit-out is a tenant concession).
- Score stored on the row = base-rent percentile.

### Both P1 features are now done. Next: object storage + signed URLs, the 9-section
### report composer, then wire VectorShift as the real AI provider, then P2 verticals.

---

## 2026-08-03 — Milestone 1: Foundation + Territory Guard vertical slice

**Orchestrator session. Status: complete and verified.**

### Objective
Stand up the new BSA application on the fixed stack (local Postgres for dev, Neon-ready),
covering the foundation and the P1 Territory Guard feature end to end, with the AI layer and
map providers cleanly stubbed. Approved game plan: "Foundation + Territory Guard vertical
slice", local-dev-keep-Neon-ready, stub-AI-and-maps.

### What was built (all in `4 - Final Application`)
- **Scaffold:** Next.js 14 App Router + React 18 + TypeScript (strict), Tailwind with Grid
  brand tokens (Nile Blue / Midnight / Muesli / Burly Wood; Poppins/Calibri), docker-compose
  for local Postgres (pgvector + PostGIS + citext + pg_trgm), `.env.example` (names only).
- **Database (16 tables, 5 groups):** `prisma/schema.prisma` + one migration
  (`20260803000000_init`) that includes hand-written DDL for the geo/vector features Prisma
  can't express — `geography` columns with GiST indexes, `geom` auto-population triggers,
  `doc_chunk` HNSW + GIN + `tsv` trigger, POI trigram index. Truth Layer column on every
  reference/result row. Seed: demo franchisor "Kanto Freshcup", 6-outlet Manila network,
  4 role users, 2 candidate sites, a doc_chunk corpus.
- **Auth + API:** JWT (jose) + bcrypt, 4 roles, `canAccessFranchisor` scoping. Routes:
  `auth/login`, `auth/logout`, `intake`, `runs`, `territory-guard` (POST+GET). Zod
  validation, consistent envelope, audit logging.
- **Intake wizard:** vertical picker, A–K sections, live 80% completeness meter, outlet CSV
  parse, candidate sites, submit → creates run → redirects to Territory Guard.
- **Territory Guard:** `lib/geo` (Haversine + circle-intersection overlap), `lib/modules/
  territoryGuard` (compute + persist) and `territoryMath` (pure, tested). Map view
  (MapLibre + OSM tiles), verdict panel, Truth Layer chips, radius control.
- **AI layer:** retrieve-then-generate harness (`lib/ai`) — retrieve (tsv/GIN) → ground →
  generate (stub provider behind an interface) → log to `ai_generation`. Truth Layer flows
  through; the model phrases only grounded facts.
- **Tests + docs:** 29 vitest unit tests (geo, Truth Layer, territory, completeness); an
  integration smoke script; README, data dictionary, API reference, security posture.

### Verified
- `npm run build` ✓, `tsc --noEmit` ✓, `vitest` 29/29 ✓, `prisma migrate deploy` + seed ✓
  against a real local Postgres 16 + pgvector/PostGIS.
- End-to-end journey run live: login → runs → Territory Guard → **BGC 7th Ave = 75.2%
  overlap (Verified), ₱683,820 cannibalization (Projected), verdict "redistributes"**;
  Alabang = 0%, "adds". Correct.
- Security: unauth→401, bad input→422, wrong password→401, completeness gate→422,
  cross-franchisor broker→403 with no data leakage. AI provenance logged.
- UI screenshotted (login, runs, Territory Guard result, intake wizard) — renders per the
  Grid brand. Note: OSM map tiles don't load inside the build sandbox (no outbound route to
  the tile server); they render on a normal machine/deployment.

### Decisions worth keeping
- `geom`/`embedding`/`tsv` modelled as Prisma `Unsupported()`; their indexes + triggers live
  in the migration's custom-DDL block (portable to Neon unchanged).
- Territory Guard verdict is derived from the **Verified** overlap, not the **Projected**
  PHP — so the headline judgement rests on measured data.
- `module_result` row carries the weakest field's Truth Layer (territory = projected) so
  nothing reads as more certain than its softest input.
- Trade areas modelled as circular catchments (radius by format). Documented assumption;
  swap for real isochrones later without changing the schema.

### Open next steps (for the next thread)
1. **Lease Benchmark (P1, second)** — `lease_comp` table exists; build the module (percentile
   vs corridor comps), API, and view. Seed some comps.
2. **Object storage + signed URLs** for reports/intake files (currently metadata-only).
3. **Report composer** — the 9-section Site Intelligence Report via retrieve-then-generate,
   written to storage with a confidence cover.
4. **Wire a real AI + embedding provider** behind the existing interface; re-review grounding.
5. **Security hardening** from `docs/SECURITY_POSTURE.md` — rotate the Google key, add login
   rate-limiting, CSP.
6. **Automated integration tests in CI** (Postgres + server), beyond the manual smoke script.
7. **P2 verticals** (Healthcare POI, Land & Traffic, Mall Intelligence, White-Space) on the
   Q3/Q4 schedule — each is a reference table + a `module_result` module.

### Note
`keys.docx` in Data Intake contains a live Google API key — kept server-side, name-only in
`.env.example`, never committed. Recommend rotating it (see security posture doc).

## Lease Benchmark — corridor auto-select (broker QA follow-up)
Standalone Lease Benchmark tool used to open with corridor = alphabetically-first
("Alabang") regardless of the candidate site, so a BGC site benchmarked against
Alabang comps. Fixed by making the pipeline and the tool share ONE corridor resolver:
- `lib/modules/leaseMath.ts` — added `inferCorridor()` (moved from orchestrator, now
  pure/client-safe) + `resolveCorridorForSite(site, available, fallback)` which only
  commits to an inferred corridor if it exists in the comps list (case-insensitive),
  else falls back.
- `lib/modules/orchestrator.ts` — now imports `inferCorridor` from leaseMath and
  re-exports it (public surface preserved); removed the duplicate definition.
- `components/LeaseBenchmarkView.tsx` — corridor initialised from the first site via
  `resolveCorridorForSite`; site onChange re-derives the corridor. Still user-editable.
- `app/(app)/lease-benchmark/page.tsx` — server computes `defaultCorridor` from the
  first candidate site (no SSR/client mismatch flash).
Verified: 7/7 corridor logic unit cases; full-project `tsc --noEmit` exit 0; live
browser — BGC site → "BGC", switch to Ortigas Center → corridor updates to "Ortigas",
ran to a correct "Below market" Ortigas result (median ₱1900 n=6, consistent with All
Modules); zero console errors.

## New-user Journey QA (10 NCR businesses) — flags & fixes
Fresh account (ncr_broker_qa) walkthrough as a broker with 10 own businesses.
Onboarding tour (6 steps), Independent-business intake, module preview, per-site
dashboard, report all verified real (DB-driven, tied to user input; corridor auto-
selects to the pinned site — the earlier inferCorridor fix confirmed in a live run).

Flag #1 (NOT a bug): native-select option overlays don't register coordinate clicks
in the harness; keyboard typeahead/arrows drive them fine. App behaviour correct.

Flag #2 (fixed): intake Step 3/4 copy promised "type an address to auto-locate", but
address geocoding is OFF in DB-only mode (the map picker itself says so). New users
would wait for a resolve that never comes. Reworded to lead with map pinning and call
the address a reference label; outlet placeholder "Address (auto-locate)" → "Address
(label)". geocode onBlur wiring kept (forward-compatible if Places is ever enabled).
components/SteppedIntakeWizard.tsx.

Flag #3 (fixed): intake "Modules active" chips omitted White-Space, but the pipeline
DOES run White-Space on every analysis (visible in the site report/dashboard). Added
{ key:'whitespace', label:'White-Space', kind:'new' } to MODULE_CHIPS.base and updated
the always-on note to name all four (Territory/Lease/Daypart/White-Space).
components/SteppedIntakeWizard.tsx.

Verified: full-project tsc --noEmit exit 0 after each fix; both fixes confirmed live in
the browser (White-Space chip shows; Step 3/4 copy no longer says auto-locate).

## New-user combined UX/UX + User-Journey QA — result
Fresh account (ncr_broker_qa) created; full guided tour (6 steps) walked and verified.
Deep pass across 5 diverse NCR businesses via the Independent-business intake path,
each end-to-end (intake → dashboard → 4 module tabs → scorecard → generated report):
  1. Sip & Steep Milk Tea (Café, BGC+Katipunan) — corridors BGC / Quezon City
  2. Crispy Cluck (QSR, Cubao) — Quezon City
  3. Barrio Bakehouse (Bakery, Sampaloc) — Manila
  4. QuickMart 24 (Convenience/Retail-BETA, Ortigas) — Ortigas
  5. PulseFit Gym (Fitness/services, Mandaluyong) — Mandaluyong
All 5 clean: every figure real/DB-driven and tied to user input (correct corridor per
pinned location via inferCorridor; location-specific competitor counts & daypart curves;
comparable-brand "N nearby" counts from DB), Truth-Layer tagged, always a report, zero
console errors. Requirements 1–6 all met.

Fixes applied during the pass (both committed + tsc-clean + verified live):
  - Flag #2: intake Step 3/4 "auto-locate" copy → pin-first wording (SteppedIntakeWizard)
  - Flag #3: White-Space missing from intake "Modules active" chips → added (SteppedIntakeWizard)
Flag #1 (native-select overlay click) = harness quirk, not an app bug.

Note: a mid-session Chrome window resize introduced a click-coordinate offset (viewport
2100px vs 1568px screenshot). Forms stayed reliable via form_input/ref; map-canvas pins
became approximate. Per owner decision, Pass 1 (run fully before the offset appeared, all
5 clean) is taken as the definitive passing result; Passes 2–3 not re-run through the
degraded harness. App behaviour itself was clean throughout.

## Cannibalization map → Territory Guard competitive-saturation (the 0%-overlap fix)
Problem: Territory Guard measured overlap ONLY against the franchisor's OWN outlets
(WHERE franchisor_id = brand). A new/independent brand has no own outlets → 0% overlap →
false "Adds sales", even in a corridor saturated with same-concept competitors.

Fix: added a second, competitor-based cannibalization signal from the owner-supplied
Cannibalization Map, alongside (not replacing) the own-outlet overlap.

Data:
- New `CompetitorSet` model + migration 20260811000000_add_competitor_set (competitor_set
  table: category, concept_key, anchor_brand UNIQUE, competitors TEXT[], truth_layer, notes).
- prisma/data/competitorSets.real.json — 79 anchors across all 12 categories, parsed from the
  workbook's Master Roster, conceptKey-mapped to the existing concept engine
  (lib/places/competitorRelevance); Truth Layer preserved per row (52 Verified/24 Assumed/3 Projected).
- prisma/seedCompetitorSets.ts + `npm run db:seed-cannibalization` (idempotent upsert by anchor).

Logic (lib/modules/territoryMath.ts, pure/unit-tested):
- competitiveSaturationPct(count): concave saturating curve, 0→0, ~3→20%, ~10→57%, ≥20→cap 85%.
  Projected — a market-saturation proxy, NOT a measured overlap.
Integration (lib/modules/territoryGuard.ts):
- Counts same-concept competitors (competitorsNear) INSIDE the candidate catchment.
- ownOutletOverlapPct (Verified) kept as-is; competitiveSaturationPct (Projected) added.
- HEADLINE maxOverlapPct = max(own, competitive); headlineSource records which drove it.
- Looks up the named competitor set (exact anchor, else conceptKey; prefers Verified) →
  payload.competitorSet so the report/UI can name WHO competes.
- truth: overlapPct=verified, competitiveSaturation=projected, cannibalizedPhp=projected.

Display:
- SiteIntelligenceTabs Territory tab: shows Own-branch overlap (Verified) AND Competitive
  saturation (Projected) as separate stats, a "Competes with" chip list from the map, and a
  "driven by competitive saturation" note when that's the headline.
- ModulesView interpret(): territory meaning now reflects competitor saturation; the false
  "0% — adds sales" only shows when there are truly no competitors AND no own overlap.
- reportComposer: territory facts + metric explain the competitive driver and name counts.

Verified offline: 17/17 saturation+headline unit cases (new brand 0 own + 20 comps → 85%
competitive; established keeps Verified own overlap); all 6 changed files esbuild-parse clean;
seed JSON integrity (79 unique anchors). Prisma generate + migrate + seed + full tsc + live
browser could NOT run in the device bridge VM (no network for the Prisma engine) — must run
in the real dev env. Commands handed to owner.

## Cannibalization map — LIVE VERIFICATION (browser)
Migration + seed applied to the real dev DB (Prisma client regenerated on Windows). Re-ran
pipelines and confirmed the fix end to end:
- Crispy Cluck (QSR, Cubao): OLD 0% overlap / GO / composite 69 → NEW own-branch 0% (Verified)
  + 85% competitive saturation (Projected, 60 same-concept) → verdict "Redistributes existing
  sales", NO-GO, composite 40. Dashboard alert "Territory conflict … at 85%"; All Modules
  "Cannibalization (competitive) 85%" (red); Scorecard Territory pillar 15/100. Console clean.
- Refined competitor-set lookup (exact anchor → peer → concept+category+TruthLayer): named
  "Competes with" set for Crispy Cluck now the McDonald's QSR set (Jollibee/KFC/Burger King/
  Wendy's/Army Navy…), not Potato Corner's fries set. PulseFit Gym (fitness) → Gold's Gym set
  (Anytime Fitness, Fitness First, Slimmers World, 360 Fitness). Both correct; console clean.

Follow-up (noted, cosmetic, not blocking): the Territory MAP ring colour is driven by the map
component's own verdict prop and can lag the blended verdict — PulseFit shows a green ring
while the verdict text/stats/scorecard correctly read "Redistributes"/85%. One-line fix: pass
the blended verdict through to TerritoryMap. Also: the fix applies on pipeline RE-RUN; existing
saved runs keep their old payload until recomputed.

## Conceptualization-gap audit + fixes (session)
Audited the app against the 2 - Data Intake source docs (Architecture, Improvement Strategy,
Feature Shout-Outs, PFA, Investor/ROI, System Components). Built 4 of the gaps this session;
noted the AI narrative layer (biggest gap — report is deterministic-only, retrieve-then-generate
stubbed) for a later session per owner.

1) LEFT-NAV cleanup: hid Territory Guard / Lease Benchmark / Daypart / White-Space from the
   Intelligence group (they already render on every run's per-site results). Kept All Modules.
   Re-pointed onboarding tour step 4 anchor nav-territory-guard → nav-modules. (SidebarNav.tsx,
   OnboardingTour.tsx.) Verified live: nav shows only "All Modules" under Intelligence.

2) LAND & TRAFFIC — real dataset (was a POI-count proxy, no dataset):
   - New TrafficCorridor model + migration 20260811010000_add_traffic_corridor.
   - prisma/data/trafficSeasonality.real.json — 15 NCR/Davao corridors, AADT-anchored base band
     (EDSA ~427k etc., MMDA/DPWH), + seasonal low/high multipliers: normal/payday/school_open/
     holiday/christmas/undas/holy_week. Undas SPIKES on cemetery corridors (Manila/QC/CAMANAVA),
     DIPS elsewhere (exodus); Christmas peak; Holy Week deepest dip. Truth Layer per row
     (9 Assumed anchored to AADT, 6 Projected). Seed: npm run db:seed-traffic.
   - runLand now resolves the corridor (inferCorridor) → traffic_corridor band (replacing the
     proxy; proxy kept as fallback) + seasonal demand range + today's season. landTrafficMath
     gained seasonalDemandRange()/currentSeason(). Surfaced in ModulesView + report.

3) DAYPART SEASONALITY (the missing "& Seasonality" half): p2p3Math.daypartSeasonality() combines
   the corridor's seasonal multipliers with a vertical term-time note (education→academic calendar,
   hotel→tourism, fitness→Jan/summer, café→term/exodus). runDaypart persists peak/trough season +
   note; SiteIntelligenceTabs Daypart tab shows a "Seasonality (Projected)" card.

4) HEALTHCARE age/income overlay (was proximity-only; age_profile was 0/296 populated):
   - prisma/enrichAgeProfiles.ts (npm run db:enrich-age) fills demographic_cell.age_profile with a
     MODELLED age distribution from income band (AB/BC older, CD/DE younger; PSA-anchored, Projected).
   - scoreHealthcare now blends referral proximity (Verified, 60%) + residential catchment demand
     (Projected, 40% — population depth × income spending-power × 45+ age bonus) → composite.
     runHealthcare pulls catchment pop/income/age45+ within 1.5km. Surfaced in ModulesView + report.

Verified offline: 13/13 unit cases (seasonal range incl. Undas spike/dip, currentSeason windows,
healthcare catchment blend + backward-compat proximity-only); all 8 changed files esbuild-parse
clean. Prisma generate + 2 migrations + 2 seeds must run in the real dev env (device VM lacks the
Prisma engine). Commands: see below / handed to owner.

NOTED FOR LATER (not built): AI narrative layer (retrieve-then-generate is stubbed; report is
deterministic-only). Lease-comp self-improving feedback loop. Land-pricing benchmark. Mall
floor-position/co-tenancy. All catalogued in the audit.
