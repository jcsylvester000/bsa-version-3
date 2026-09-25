# BSA Work Log

The cross-thread state record. Read this (with the Master Instruction and the current
`4 - Final Application` tree) before continuing — continue, don't restart.

---

## 2026-09-25 — Code-health subset: F-47 done; F-43/F-44/F-46 progressed (⏳ awaiting push)

Scope confirmed with the user: safe, build-verifiable work now; infra-bound parts (integration DB, Playwright, full component split) documented as follow-ups.

### F-47 — service layer (DONE)
- New `lib/services/{runs,sites,reports,account}.ts` — the one authorized data path per resource, each
  enforcing `canAccessRun` / visibility and returning typed data (discriminated results for the empty
  states). All five app pages (`runs`, `site`, `reports`, `intake`, `settings`) now call the services;
  **no `app/(app)/*/page.tsx` imports `@/lib/db/prisma` any more** (verified). API routes can reuse the
  same functions. Behaviour preserved (same queries, same safeQuery resilience, same access checks).

### F-46 — lint/consistency (partial, safe items)
- PDF route: `renderToBuffer(element as any)` → cast to the function's own parameter type
  (`Parameters<typeof renderToBuffer>[0]`), eslint-disable removed — typed, not `any`.
- `ModuleKind` unused values (`financial`/`risk`/`calibration`) documented as RESERVED extension points
  (dropping a Postgres enum value is destructive).
- Settings date already uses `manilaLongStamp` (ICU-free) — confirmed, nothing to change.
- LEFT (deliberate, documented): the 7 `react-hooks/exhaustive-deps` disables (fixing blind, with no
  runtime to test the effects, risks re-render bugs) and `font-mono` in AnalysisSequence (a stylistic
  progress read-out). Owner/dev to revisit with the app running + ESLint configured.

### F-43 — tests (partial)
- The verdict-agreement test (summariseSite ↔ scorecard band) already exists (`siteVerdict.test.ts`),
  and this fix programme added source-level guard tests covering previously-untested modules' critical
  paths: `whiteSpaceScope`, `pipelineIntegrity`, `batchLoaders`, `serverClientBoundary`,
  `securityHardening`, `sessionRevocation`, `accessibility`. Parse helpers already covered.
- REMAINS (needs infra): integration tests against a Neon test branch / local PostGIS in CI, and
  Playwright smoke (login → intake → run → site tabs → PDF). These need a database and a browser the
  build sandbox doesn't have — carried as an owner/CI task.

### F-44 — large components (partial)
- The shared primitives are already extracted to `components/ui/` (`Chips`, `StatTile`, `Panel`) by the
  design pass; the local `Chip` is a thin wrapper over the shared `StatusText`.
- REMAINS: splitting `SiteIntelligenceTabs` (~1.26k lines), `SteppedIntakeWizard` (~820),
  `FranchiseScreeningView` (~650) into per-tab/per-step files. Deferred as it needs visual regression
  checks the sandbox can't run; the shared-token extraction the audit named is done.

- **469 tests pass**, typecheck clean, build compiles (Middleware 32.8 kB).
- Workbook: F-47 → Done; F-43/F-44/F-46 → In progress; also corrected F-12 & F-42 (completed earlier)
  from In progress → Done. **41 Done, 3 In progress, 8 Open** (the 8 are owner data/creds/ops: F-16,
  F-17, F-19, F-25, F-31, F-51, F-52 and the like).

---

## 2026-09-25 — Security: F-26 session revocation + F-30 middleware/CSP nonce (⏳ awaiting push; NEW MIGRATION)

**Skills:** 04 Security (owner), 01 Senior Web & App, 11 Code QA.

### F-26 — sessions can be revoked; role/franchisor changes take effect immediately
- Schema + migration `20260927000002_session_revocation`: `app_user.sessions_valid_after`.
- `getSession` (`lib/auth/session.ts`) now reads the user row (deduped per request with React `cache()`):
  rejects the token if the user is gone or the token was issued before `sessions_valid_after`
  (pure `isTokenRevoked`, second-precision), and refreshes role/franchisor from the DB so a change
  applies without re-login. `verifySession` now returns the JWT `iat`.
- Triggers bump the cut-off: logout (`revokeUserSessions` → all devices), password change (revokes all,
  then RE-ISSUES the current device's cookie so only OTHER sessions drop). `lib/auth/revoke.ts` exposes
  `revokeUserSessions(userId)` for a future role-change endpoint.
- Mock/demo (non-UUID) sessions skip the DB path entirely.
- Test: `tests/unit/sessionRevocation.test.ts` (+5) covers the same-second boundary.

### F-30 — central auth guard + per-request CSP nonce
- New `middleware.ts` (edge): (1) a fresh nonce per request → `script-src 'self' 'nonce-…'
  'strict-dynamic'` with NO `'unsafe-inline'` (Next applies the nonce to its scripts; bundled maplibre
  loads via them; styles keep inline for maplibre/Tailwind). (2) coarse auth guard — unauthenticated app
  pages redirect to /login, APIs get 401; `/login` + the login/register APIs are public. getSession stays
  the fine-grained authority (roles, per-run ownership, F-26 revocation).
- `next.config.mjs`: the static CSP header is removed (middleware owns CSP now; two would conflict);
  the other security headers stay. `BSA_CSP_REPORT_ONLY=1` still switches to report-only, now in middleware.
- **469 tests pass**, typecheck clean, build compiles (Middleware bundle 32.8 kB).
- Workbook: F-26, F-30 → Done (38 Done total).
- **Owner actions:** deploy migration `20260927000002_session_revocation`. After deploy, sanity-check in a
  browser that the map still renders and there are no CSP violations in the console (the nonce CSP is the
  one change I could not run here); if a new third-party host is ever added, flip `BSA_CSP_REPORT_ONLY=1`
  first. **F-25 remains open** (Google API quotas) — not in this batch.

---

## 2026-09-25 — UX & accessibility set: F-36, F-37, F-39, F-40, F-41 (⏳ awaiting push)

**Skills:** 01 Senior Web & App, 07 PH Broker (older-user legibility), 09 User Journey QA, 11 Code QA.

- **F-36 (labels):** every intake outlet/candidate-row input and the 📍 Pin icon buttons now carry an
  `aria-label` (`components/SteppedIntakeWizard.tsx`). LocationPicker's search input + ✕ already had
  labels (design pass) — verified.
- **F-37 (responsive):** the intake outlet/candidate rows switch from a fixed `grid-cols-12` to
  `grid-cols-1 sm:grid-cols-12` (stack on phones); the Lease comps table wrapper is now
  `overflow-x-auto` with a `min-w` so it scrolls instead of clipping (`SiteIntelligenceTabs.tsx`).
- **F-39 (legibility):** every remaining `text-[9|10|11px]` (21 uses) raised to the 12px floor
  (`text-xs`) across FranchiseScreeningView, InfoHint, MapMarkers, OnboardingTour, ReportDownloadModal,
  ReportView, RunDashboard, VersionHistory, SteppedIntakeWizard, and `globals.css`. InfoHint's "?"
  control enlarged 4→5 (h-5 w-5) for tap/readability. Zero tiny-text uses remain.
- **F-40 (corridor picker + map verdict):**
  - Lease tab now shows a **corridor picker** when the pipeline fell back to a proxy corridor. The
    server (`site/page.tsx`) supplies `leaseCorridors` = the site region's registry corridors that have
    comps, then any other corridor with comps (for the site's format). Picking one POSTs
    `/api/lease-benchmark`; that endpoint already drops the proxy/Projected flag when the corridor
    changes, so a real pick becomes a real benchmark. (`SiteIntelligenceTabs.tsx` LeaseTab.)
  - Map verdict: TerritoryMap already renders from the passed-in `candidate.verdict` (the same value the
    Territory chip uses) — it does NOT self-compute, so ring and verdict already agree. Verified; no change.
- **F-41 (redesign):** delivered by the DESIGN v2 pass (theme tokens, FinalReportHero/FindingsList,
  `<dialog>` MobileNav, error/loading boundaries — see the DESIGN v2 entries + `docs/DESIGN_V2_CHECKLIST.md`).
  Marked Done.
- **464 tests pass**, typecheck clean, build compiles.
- Workbook: F-36/37/39/40/41 → Done (36 Done total).

---

## 2026-09-25 — F-22 batch loaders + F-23 /api/brands cache (⏳ awaiting push)

**Skills:** 02 Database (batched writes / direct pooled client), 03 API, 05 Cost, 11 Code QA.

### F-22 — reference-data loaders batched
- `prisma/scriptDb.ts` (new): a script-only PrismaClient on the DIRECT (pooled) connection — a normal
  TCP client, NOT the Neon HTTP adapter — so bulk writes get multi-row statements over a warm connection.
- `lib/ingest/loaders.ts`: `loadPoi` and `loadDemographics` now write chunked (500/statement) multi-row
  `INSERT … ON CONFLICT DO UPDATE` instead of find-then-write per row. POI upserts on osm_id (id-less
  rows insert), demographics on psgc_code with the geom buffer folded into the statement. All five
  loaders take an optional `db` (default: app client); zonal/lease/malls kept per-row (lower volume /
  delete-insert). Idempotency preserved (upsert semantics).
- Scripts (`ingest.ts`, `ingestOsm.ts`, `populate.ts`) pass `db: scriptDb()` for the batched loaders
  and disconnect it at the end.
- Result: a province-scale POI/demographic load goes from tens of thousands of round trips to
  ceil(N/500) statements — minutes, not hours.
- Test: `tests/unit/batchLoaders.test.ts` (+3) — captures the SQL, asserts chunking + ON CONFLICT shape.

### F-23 — /api/brands cache
- Was one ILIKE full scan of poi PER candidate brand (~40), sequentially, every call. Now ONE scan with
  a per-brand CASE aggregate, and the (catalog-wide, not per-user) response is cached in memory for 5 min.
  Franchise Screening loads instantly; a background POI ingest shows within the TTL.
- **464 tests pass**, app + scripts typecheck clean, build compiles.
- Workbook: F-22, F-23 → Done (31 Done total).
- **Owner note:** bulk loaders now prefer `DIRECT_URL` — set it (Neon pooled URL) in the script env, else
  they fall back to `DATABASE_URL`.

---

## 2026-09-25 — F-15 accessibility pillar + F-18 provenance/ages/re-run (⏳ awaiting push; NEW MIGRATION)

**Skills:** 02 Database, 01 Senior Web & App, 06 Research (OSM transport tags), 07 PH Broker (commuter access), 11 Code QA.

### F-15 — Site Fit accessibility pillar (was always empty)
- `lib/modules/siteFitMath.ts`: pure `scoreAccessibility({nearestTransportM,countWithinWalkM,covered})`
  — distance to a transport node weighted 0.65 over density 0.35; null when the layer isn't loaded here.
- `lib/modules/siteFit.ts`: queries `poi category='transport'` (nearest within 5 km, count within 500 m)
  and fills the pillar (Verified). If no transport node within 5 km → pillar stays null, so scores are
  UNCHANGED until the transport layer is loaded, then improve where it exists.
- Transport ingest: `lib/places/osmService.ts` gains `transportInBbox` (jeepney/bus stops, terminals,
  rail/LRT/MRT); `establishmentsInTiles` gained an optional `query` override so the same adaptive tiler
  drives it. `prisma/ingestOsm.ts` gains a `--transport` step (tiled, resumable via poi_coverage
  vertical `__transport__`). Scripts: `db:ingest:osm:transport[:cavite|:batangas]`. Unnamed stops kept
  (position is what matters), labelled generically.
- Test: `tests/unit/accessibility.test.ts` (+8).

### F-18 — provenance, real ages, historical re-run
- Schema + migration `20260927000001_poi_provenance`: `PoiSource` gains `google`; `poi.provenance` text.
  `loadPoi(rows, {source, provenance})` stamps it — OSM sweep rows now carry `osm:bulk-sweep` /
  `osm:brand-branches` / `osm:transport` instead of being mislabelled `manual`.
- `prisma/enrichAgeProfiles.ts`: uses a real PSA age-sex table when present
  (`prisma/data/demographics/age_profile.real.json`, keyed by PSGC) → Verified; falls back to the
  modelled income-band proxy → Projected. Format documented in `age_profile.README.md`.
- `prisma/rerunHistorical.ts` + `db:rerun-historical`: re-runs old runs with `refresh` (drives the slices
  to completion) so historical runs pick up current scoring. Flags: `--status=`, `--run=`, `--dry`.
- **461 tests pass**, app + scripts typecheck clean, build compiles.
- Workbook: F-15, F-18 → Done (29 Done total).
- **Owner actions:** deploy migration `20260927000001_poi_provenance`; run `db:ingest:osm:transport`
  (+ regional) to populate accessibility; optionally drop the real PSA age file then `db:enrich-age`;
  run `db:rerun-historical` once to refresh old runs.

---

## 2026-09-25 — Pipeline integrity: F-05, F-06 (⏳ awaiting push; NEW MIGRATION)

**Skills:** 02 Database (claim + rollback), 03 API, 04 Security, 11 Code QA.

- **F-05** `lib/modules/orchestrator.ts` + schema: `candidate_site` gains `claimed_at`
  (migration `20260927000000_site_claim`, plus a partial pending index). Before working a site the
  slice CLAIMS it with a single conditional `updateMany` (analyzedAt null AND claimedAt null-or-stale
  → set claimedAt). `claim.count === 0` means a concurrent invocation (second tab / double-click) owns
  it → skip. A claim older than `CLAIM_STALE_MS` (60 s) can be retaken, so a crashed slice never
  strands a site. Refresh clears `claimedAt` too.
- **F-06** `app/api/intake/route.ts`: reordered so EVERY gate (franchisor access, 80% completeness,
  version lineage) runs before any write. The independent-operator brand is now created inside the
  write phase, not before the gate. All writes are tracked (`cleanup.{createdFranchisorId,intakeId,runId}`)
  and a failure triggers a compensating rollback — delete run (cascades sites) → outlets → intake →
  the brand, but only if we created it (never a shared catalog brand). No orphan brands / half-written runs.
- Test: `tests/unit/pipelineIntegrity.test.ts` (+6). **453 tests pass**, typecheck clean, build compiles.
- Workbook: F-05, F-06 → Done (27 Done total).
- **Owner action added:** run `npx prisma migrate deploy` for `20260927000000_site_claim` (or let the
  Netlify build run it). Until the column exists the claim update will error — deploy the migration with this push.

---

## 2026-09-25 — White-Space local scoping: F-11, F-20 (⏳ awaiting push)

**Skills:** 02 Database (PostGIS scoping), 01 Senior Web & App, 07 PH Broker (local relevance), 11 Code QA.

- **F-11 + F-20** `lib/modules/runWhiteSpace`: every geographic read is now scoped to a 15 km radius
  around the proposed site (`WHITESPACE_SCAN_RADIUS_M`), via `ST_DWithin`:
  - competitor POIs: read out to `scanR + catchment` (an edge area's 1 km catchment still fully covered);
  - demographic_cell candidate areas: within `scanR`;
  - POI-fallback clusters: within `scanR`;
  - own outlets: within `scanR + 2× catchment` (beyond that the overlap proxy is 0).
- **F-11 result:** recommendations are always local — an NCR site can no longer surface a Davao barangay.
  Distance (not a hard region tag) is the guarantee, so a border site (e.g. Las Piñas) still sees nearby
  cross-border areas (Bacoor, Cavite). `scanRadiusM` is now in the payload.
- **F-20 result:** the in-memory areas × POIs loop runs over a small local set instead of the national
  dataset, so cost is bounded by local density and stays flat as more provinces load. The tier-weighting
  (name-based `tierFor`/`weightedCompetitorCount`) has to stay in JS, so reads are scoped rather than
  rewritten as a pure PostGIS GROUP BY — same effect, no scoring rewrite.
- Test: `tests/unit/whiteSpaceScope.test.ts` (+5) guards that each read keeps its ST_DWithin scope.
  **447 tests pass**, typecheck clean, build compiles.
- Workbook: F-11, F-20 → Done (25 Done total).

---

## 2026-09-25 — Audit security batch: F-24, F-27, F-28, F-29 (⏳ awaiting push)

**Skills:** 04 Security (owner), 03 API, 11 Code QA.

- **F-24** `app/api/intake/route.ts`: the 500 no longer echoes `err.message` (Prisma/Neon text leaked
  table/column details). It logs the full error server-side with a short `ref=` and returns a generic message quoting that ref.
- **F-27** Login split: `app/(auth)/login/page.tsx` is now a Server Component that passes `demo={isMockAuth()}`
  to the new client `components/LoginForm.tsx`. Demo credentials are prefilled and hinted **only** when demo logins
  actually work. On Netlify the form starts empty.
- **F-28** `app/api/auth/password/route.ts`: `checkLimit('password_change_failed', auth_account, userId)`
  (5 per 15 min, `LIMITS.passwordChangePerAccount`). Each wrong current password is recorded, and the limit is checked before any bcrypt work.
- **F-29** Hardening:
  - territory-guard returns 404 on a non-UUID runId (was a DB 500).
  - maptiles now send `Cache-Control: private` (was public).
  - `clientIp` trusts only `x-nf-client-connection-ip` on a hosted deployment (XFF is used only locally).
  - `checkLimit` **fails closed** when the count can't be read.
  - Franchisor create no longer writes the user's email into `positioning`.
- Tests: `tests/unit/securityHardening.test.ts` (+6). **442 tests pass**, typecheck is clean, and the build compiles.
- Workbook: F-24/27/28/29 → Done (23 Done total).
- Note: fail-closed means that if Neon is down, login returns "too many attempts" (429) instead of 401. Login can't succeed without the DB anyway.

---

## 2026-09-25 — DESIGN v2 (cont.): remaining mockup screens, batches 5–8 (✅ PUSHED — 1fc780c, 89deb3c, 12ab500, df39955)

Batches 1–4 confirmed pushed (`75fcd15`, `60404b1`, `da9afc5`, `f82716d`; batch 0 = `0ecddcd`).
This pass covers mockup screens the bundle drew but shipped no code for. Tracker: `docs/DESIGN_V2_CHECKLIST.md`.
**Skills:** 12 Orchestration, 01 Senior Web & App, 07 PH Broker (tier/seasonality/zonal wording), 04 Security
(error boundary + `?brand=` hand-over), 11 Code QA.

- **Batch 5 (B3/H1/H2):** `/runs` is now a results table (Proceed/Caution/No-Go counts per run from one flat
  `candidate_site` read — no include/transaction, safe on Neon HTTP), search + brand filter via GET form,
  empty and no-match states. Run dashboard shows an in-progress card (n of N analysed) with
  **↻ Continue analysis** (`RunPipelineButton resume` — resumes slices, no restart) and a failed-run alert.
- **Batch 6 (D1/D2):** Franchise Screening results are cards with removable filter chips, skeleton loading and
  a no-results state. "Start intake with this brand" → `/intake?brand=` → the wizard preselects the brand +
  vertical, matched only against the user-visible catalog (`/api/franchisors`), so the param can't widen access.
- **Batch 7 (F1–F4/H3):** Lease tab header "Position vs corridor", H3 not-enough-data copy (uses `MIN_SAMPLE`),
  "Save & use in score", BIR zonal floor card (Truth chip from payload, `ZONAL_FLOOR_NOTE`); Daypart window
  match with status word + peak window (`12 NN` format); Territory/White-Space restyle. **FindingsList figures
  wired** from the same payloads (each with its own Truth Layer).
- **Batch 8 (G1/H4):** Settings restyle (ICU-free member-since), password form help/alert; new
  `app/(app)/error.tsx` (generic message + digest, no internals) and `app/(app)/loading.tsx` skeleton.

**Verification:** tsc 0 errors · vitest 36 files 426/426 · `next build` compiles (sandbox-only warnings: Google
Fonts download and Prisma engine unavailable). Not verified live in a browser against Neon.

**⚠️ ACTION REQUIRED (owner):** run the Batch 5–8 commands in the checklist, then paste `git log --oneline -6`.
Smoke test after deploy: /runs list + search; open an unfinished run (Continue analysis); Screening → Start
intake with a brand; a site's Lease tab (zonal card) and Final Report (figures beside findings).

**Noticed, not changed:** PRC licence field (G1) needs a schema decision; the light-theme switch stays deferred;
`/reports`, `/scorecard`, `/modules`, `/explore` (not in the menu) still use pre-v2 layouts; the Lease finding
in `siteVerdict.ts` still carries a go/caution tone (drives the call by design — flagged for a broker review).

---

## 2026-09-25 — DESIGN v2: Claude Design bundle implemented (CODE COMPLETE — pending push, batches 0–4)

**Skills loaded:** 12 Orchestration (plan/batches/log), 01 Senior Web & App Engineer (structure),
07 PH Broker (guardrail wording on rent), 11 Code QA (verification). Tracker: `docs/DESIGN_V2_CHECKLIST.md`.
**Owner decisions:** theme-ready but dark only (no light toggle yet) · one push per batch.

- **Batch 0 — pending audit fixes** (uncommitted at thread start; the owner committed them mid-session as
  `0ecddcd`, so nothing further to do): run route
  `maxDuration = 26` (F-04), `prisma migrate deploy` in the Netlify build (F-49), build id (F-50), tour copy, CI.
- **Batch 1 — foundation:** bundle `tailwind.config.ts` + `app/globals.css` (CSS-variable tokens, AA status
  colours, component recipes, `.mk-*` markers, themed MapLibre), `ui/Chips`, `ui/Panel`, `ui/StatTile`,
  `TruthChip` re-export; `GridLogo` dark/light pair; `<html data-theme="dark">`.
- **Batch 2 — shell + dashboard:** bundle `(app)/layout.tsx` (sticky 248px rail, skip link, RA 9646 footer —
  **build id kept**, the bundle had dropped it), `SidebarNav`, `LogoutButton`, `MobileNav` (native `<dialog>`,
  replaces the F-32 drawer), `RunDashboard` (verdict strip; rows → Final Report). `RunPipelineButton` takes
  `className` (default `btn-secondary btn-lg`). "Rent above median" tile made neutral (guardrail).
- **Batch 3 — site page + Final Report (PATCHES §1):** `FinalReport.tsx`; `SiteIntelligenceTabs` 1a–1i
  (underline tabs + roving tabindex + ← →, TruthLegend, StatusText chips, stat tiles with truth chips instead
  of "(Projected)" text, compact chips in ReportRows, hero + findings + 2-col module summaries with "Open … ›",
  lease judgement cues removed); `site/page.tsx` header (Re-run + Export site PDF), `?tab=` validated against
  `TAB_KEYS`, hero context (composite from Decimal, rank via the dashboard ordering, run confidence,
  `manilaShortStampYear(analyzedAt)`, truth mix of the site's module rows). Hero honours F-07: shows
  "Not enough data" only when the site has no composite band. `LeaseDistributionChart` asking bar is one
  neutral colour. "Negotiating room to median" → "Distance from corridor median".
- **Batch 4 — login, intake, maps (PATCHES §2–4):** login two-column C1 layout, tablist, `field-label`,
  alert error, confirm-field `field-error` + `aria-invalid`; wizard 4-column stepper, `field-label` + `mt-1.5`,
  step-4 "What happens next" + "Before you submit" (from `computeCompleteness` + pins), Back/Submit
  `btn-lg` with Submit `flex-[2]`; new `components/MapMarkers.tsx` used by Territory/Gaps/LocationPicker
  (markers wrap the rotated shape so MapLibre's own transform isn't clobbered), legends, sr-only lists;
  LocationPicker is a labelled dialog with 44px controls.

**Verification (cloud sandbox copy):** `tsc --noEmit` 0 errors · `vitest run` 36 files / **426/426** pass
(4 "unhandled" Prisma-engine-not-found rejections are sandbox-only — the engine download is blocked; same
as prior batches) · `next build` compiles all routes. **Not verified:** a live browser session against Neon
(visual match with `design-reference/*.dc.html`, keyboard pass, 44px targets).

**⚠️ ACTION REQUIRED (owner):** run the per-batch push commands in `docs/DESIGN_V2_CHECKLIST.md` (also
given in chat), then paste `git log --oneline -6` so the push-log hashes can be recorded. After Netlify
deploys: open a run → a site (should land on Final Report), tab through with the keyboard, try the phone menu.

**Noticed, not changed:** reports/scorecard/modules/explore/screening/settings pages still use pre-v2 markup
(they inherit the new tokens, but not the new layouts); `FindingsList` `figures` left unwired; light toggle deferred.

---

## 2026-09-25 — HOTFIX: React hydration #418/#423 (locale/timezone drift) + 502 triage

Reported: console `Minified React error #418` + `#423`, and repeated `POST /api/analysis-report 502`.

**Hydration (#418 text mismatch → #423 recovery) — ROOT CAUSE + FIX.** Client components are
server-rendered then hydrated; any formatting that depends on the *runtime's* locale or timezone
differs between the server (UTC / server locale) and the browser (Manila / user locale), so the
SSR HTML ≠ the hydration HTML → #418, and React's recovery re-render → #423. Two classes remained
after Batch 5:
- **Dates without a fixed timezone.** `RunNameEditor` used `new Date(x).toLocaleString(undefined,…)`
  → server showed the UTC hour, browser the Manila hour. Now `manilaShortStampYear` (new, in
  `lib/util/manilaTime.ts` — same ICU-free +8h method as the other stamps). `runs/page.tsx` (a
  server component, so not a hydration bug but it showed UTC) switched to the same stamp for
  correctness.
- **Numbers via `.toLocaleString()`.** ~15 call sites across `SiteIntelligenceTabs`, `ReportView`,
  `ModulesView`, `FranchiseScreeningView` grouped digits with the runtime locale (server "1,234"
  vs a non-en browser "1.234"). New `lib/util/format.ts` (`fmtInt`/`fmtPeso`) groups with a fixed
  comma, no ICU — identical on both sides. All client-component `.toLocaleString()` calls replaced;
  `tests/unit/format.test.ts` added. Grep confirms no live `.toLocale*` left in any `'use client'`
  file. **414/414 tests, typecheck clean, `next build` compiles.**

**502 `reason: internal` on /api/analysis-report — REAL ROOT CAUSE (from the server log) + FIX.**
The server log showed `prisma:error Transactions are not supported in HTTP mode` → the `internal`
502. The Neon **HTTP** adapter (`PrismaNeonHTTP`) does not support transactions, and Prisma opens an
**implicit** transaction for the ONE query in `generateLocked` that combined
`findUniqueOrThrow` **with a multi-relation `include`** (`pipelineRun` → `franchisor` + `intake`).
That combination is unique to the analysis path — the pipeline uses `findUniqueOrThrow` with a *flat
select* (works) and the dashboards use `include` on *non-OrThrow* reads (works), which is why only
the Analysis Report 502'd.
- **Fix:** replaced the `findUniqueOrThrow({ include: … })` with **sequential flat reads** — run
  (`select` scalars + `franchisorId` + `intakeSubmissionId`), then `franchisor.findUnique`, then
  `intakeSubmission.findUnique` — exactly the "split nested reads into sequential calls" rule the
  `lib/db/prisma.ts` header already states for the HTTP adapter. No `include` → no transaction.
- **Hardening that rode along (still valuable):** `retrieve()` (`lib/ai/retrieveThenGenerate.ts`) is
  now fault-tolerant (returns `[]` if the `doc_chunk` corpus is missing/unseeded — optional grounding
  must never 502 the analysis), and `isMissingSchemaError` recognises raw-SQL missing-schema
  (P2010 + `42P01`/`42703`) so a behind-the-schema DB reads as **503 db_migration_pending**, not a
  confusing 502.
- **414/414 tests, typecheck clean, `next build` compiles.** This is the actual unblock; a slow-but-
  successful VectorShift run (the timeout case) is addressed separately by the async polling work.

**Watch for the same trap elsewhere:** other `findUniqueOrThrow({ include })` combos would hit the
same neon-http transaction error. A scan found none on other request paths (dashboards use
non-OrThrow `include`; the pipeline uses flat-select `findUniqueOrThrow`). If a new one is added, use
sequential flat reads under the HTTP adapter.

---

## 2026-09-25 — Analysis 502 (transaction) FULL FIX + async polling + menu trim

**1) Transaction 502 — the actual server error was `Transactions are not supported in HTTP mode`.**
The Neon **HTTP** adapter can't transact, and Prisma opened an implicit transaction in `generateLocked`.
Removed BOTH triggers on the analysis path: the multi-relation `include` (→ sequential flat
`findUnique`s) AND `findUniqueOrThrow` (→ `findUnique` + explicit null check). That combination —
OrThrow *with* a multi-relation include — was unique to this path, which is why only the Analysis
Report 502'd while the pipeline (flat-select OrThrow) and dashboards (non-OrThrow include) worked.

**2) Async polling (Netlify Background Function) — the requested "leave the channel open" pattern.**
Removes the 26s sync-function ceiling so a slow-but-successful VectorShift run no longer times out.
- Split the generator: `claimAnalysisReport` (fast lock claim) + `executeAnalysisReport` (the slow
  retrieve→generate→persist; never throws — persists a `failed` marker with the reason).
  `generateAnalysisReport` = claim+execute inline (stub / async-off path). New cache state `failed`
  (`isFailedPayload`), `LOCK_TTL_MS` 90s→5min, `readAnalysis` returns `failed`.
- `lib/ai/enqueue.ts` posts the job to the background function; `netlify/functions/
  analysis-report-background.mts` runs `executeAnalysisReport` off-request (auth via
  `INTERNAL_JOB_SECRET`). Bundling: `netlify/functions/tsconfig.json` (resolves `@/*`) +
  `netlify.toml` `[functions]` esbuild + `included_files` (Prisma). POST now CLAIMS then enqueues
  (202 generating) or runs inline; GET returns `error` on a failed job. The client already polled the
  status endpoint — extended its budget to ~5 min and added `error` handling.
- **OFF by default** (`ANALYSIS_BACKGROUND=1` to enable) → deploying this changes nothing until the
  owner opts in and confirms the function deployed; enqueue failure falls back to inline. Full guide:
  `docs/ASYNC_ANALYSIS.md`.

**3) Menu trim (owner request):** removed **Explore Places**, **All Modules**, **Scorecard** from the
left rail (`SidebarNav.tsx`) — only Workspace (Franchise Screening · Site Dashboard · New Intake)
remains. Routes untouched; just unlinked.

**416/416 tests** (added `format`, `analysisRuntime` failed-state cases), typecheck clean, `next build`
compiles. Also rode along earlier (still-undeployed) fixes: hydration #418/#423 (deterministic number
+ Manila-time formatting) and fault-tolerant `retrieve()`.

**⚠️ To actually clear the error the owner must REDEPLOY** (Netlify) / restart the local dev server —
the identical error + run/site id suggests the previous build was still running. Test on a fresh site,
and clear any site stuck in `generating` by regenerating.

---

## 2026-09-26 — HOTFIX (root cause found): every site page crashed on the server

Symptom (build b58ac84): dashboard loads, but clicking ANY site (even a brand-new run) shows "We
couldn't load this page" — console: "An error occurred in the Server Components render" + React
#329/#418/#423. **Root cause:** `app/(app)/site/page.tsx` (a Server Component) imported the runtime value
`TAB_KEYS` from `components/SiteIntelligenceTabs` (a 'use client' module) and called
`TAB_KEYS.includes(...)` to validate `?tab=`. Next.js only gives server code a client-reference proxy for
values exported by a client module, so every site-page render threw. Builds/typecheck can't catch it.
**Reproduced locally** (production build + a self-signed test session): old code logs
`Attempted to call includes() from the server but includes is on the client` with a digest; fixed code
gets past it (0 occurrences).
- Fix: new server-safe `lib/ui/siteTabs.ts` (`SITE_TAB_KEYS`, `isSiteTabKey`); the site page uses it.
- Guard: `tests/unit/serverClientBoundary.test.ts` — keys stay in sync with the client TABS, and the test
  FAILS if any server file ever imports a non-component value from a 'use client' module again.
**436 tests, typecheck clean, build compiles.** (The verdict-key guards in the entry below are still a
valid latent-bug fix for old payloads, but were not the cause of this crash.)

---

## 2026-09-26 — HOTFIX: site page #329 (server-render crash) on older runs

Symptom: opening a specific run's site page (?tab=analysis) 500'd with React #329 (server-render
error) + #423 (hydration). Root cause: the verdict→label maps are indexed by a payload value that is
only guarded for null (`t?.verdict ?? 'mixed'`), so an older run whose stored territory/lease
`verdict` is outside the current `T_VERDICT` / `L_VERDICT` keys made `T_VERDICT[unknown]` undefined and
`.label` / `.tone` throw during SSR. Fixed all four derivations to validate the value against the map
before indexing (`x in T_VERDICT ? x : 'mixed'`), covering the 6 access points (TerritoryTab,
LeaseTab, and the two AnalysisTab sections). Also hardened `run.franchisor?.brandName` on the runs +
site pages (a franchisor-less run would 500 the same way). **433 tests, typecheck clean, build
compiles.** No DB change.

- **F-45:** `siteVerdict.ts` and `SiteIntelligenceTabs.tsx` now use the single shared `fmtPeso`
  (`lib/util/format.ts`) instead of local copies. `VERDICT_COLOR` was already single-source
  (`lib/geo/mapGeometry.ts`, design pass). The two `fmtPhp`s are intentionally different (backend
  reason-strings with no ₱ vs UI with ₱ + null handling), left as-is.
- **Prod #329 triage / hardening:** a live Server-Components render error (#329, digest in the Netlify
  log) on the signed-in pages. Hardened the one genuine latent crash it could be: `run.franchisor.brandName`
  assumed the relation is never null — an orphaned run (franchisor deleted) would throw during SSR.
  Now `run.franchisor?.brandName ?? 'Unknown brand'` on the runs list, run detail and site pages.
  The actual cause must be read from the Netlify function log (digest) — most likely a pending Prisma
  migration on the deployed DB or a null relation.

**433 tests, typecheck clean, `next build` compiles.** Audit workbook: 19 Done.

---

## 2026-09-26 — Audit fix F-14 (lease-comp freshness)

`observedDate` was only used to sort comps — never surfaced. Added a pure `leaseFreshness()` in
`leaseMath.ts` (data-as-of = newest comp date; `staleCompCount`; `isStale` when even the newest comp is
older than `LEASE_STALE_MONTHS` = 18). `runLeaseBenchmark` selects `observedDate`, computes freshness,
adds it to the result + payload, and raises a `lease_comps_stale` flag for an ageing corridor. The
Lease read now shows a "Comps data as of <date>" row (with "· ageing" when stale). Scoring is
unchanged — down-weighting/excluding old comps is a noted follow-up; this makes recency visible.
New tests. **433 tests, typecheck clean, build compiles.** Audit workbook: 18 Done.

---

## 2026-09-26 — Audit fixes batch 5 (F-21 done, F-12 partial — schema keys + indexes)

New migration `20260926000000_schema_keys_indexes` (idempotent, non-destructive):
- **F-21 (done):** `@@index([pipelineRunId])` on `module_result` (filtered on every dashboard load, the
  report composer, and the ON DELETE CASCADE — previously unindexed); dropped the duplicate GiST index
  on `demographic_cell.geom` (`_geom_gist` left over from init alongside `_geom_gix`); added the missing
  `prisma/migrations/migration_lock.toml`. (Residual micro-opt, not done: rewriting nearest-row lookups
  to the KNN `<->` operator — low impact on small tables.)
- **F-12 (partial):** added a `region` column + index to `demographic_cell` and made
  `db:load-demographics` stamp the PSA region, enabling region-scoped catchment/white-space reads.
  NOT done (deferred — risky on existing rows + needs loader coordination): a unique key on
  `mall_property (region, mall_name)` and a natural key on `lease_comp`.

**430 tests, typecheck clean, `next build` compiles.** Audit workbook: 17 Done, F-12 In progress.
**⚠️ Owner:** deploy applies the migration automatically now (F-49); to apply locally run
`npx prisma migrate deploy`.

---

## 2026-09-26 — Audit fixes batch 4 (F-08, F-09, F-10 — regional data honesty)

Removed the last NCR assumptions from provincial scoring.

- **F-08 — rent-to-land calibration is now per region.** Added `zonalRentBand` to the region registry
  (NCR = ₱6–14/₱1,000; other regions undefined). `zonalRentCrossCheck` / `indicativeRentFromZonal` take
  a `band` (defaults to NCR for existing callers); `leaseBenchmark` passes the site's region band, and
  a region with no calibration WITHHOLDS the cross-check/indicative ('unknown' / null) instead of
  judging provincial rent by the NCR band. Note text no longer hard-codes "NCR". New tests.
- **F-09 — region-aware corridor fallback.** When no corridor matches, the orchestrator now falls back
  to the site's OWN region's default corridor (province → its corridor, which returns insufficient_data
  honestly if no comps are loaded) instead of always the NCR "Quezon City" proxy. NCR/unknown keeps the
  QC proxy. Still flagged `corridor_default_fallback` + Projected.
- **F-10 — no more confident scores from missing data.** Daypart's last-resort nearest demographic cell
  is capped at 6 km (`ST_DWithin`) so it can't borrow a cell from another region/city. Informal now
  distinguishes a genuinely open market from a coverage gap: a 0 competitor count with ZERO POIs of any
  kind within 2 km is flagged `low_poi_coverage` and the row is downgraded Assumed → Projected (so
  "no competition → high score" reads as low-confidence). Healthcare was already correct (its aggregate
  drives no-data off `nearestFacilityM = null`).

**426/426 + new tests (14 in zonalLease), typecheck clean, `next build` compiles.** Audit workbook: 16
Done. No DB migration.

---

## 2026-09-26 — Audit fixes batch 3 (F-34, F-42 partial) + design pass reconciliation

Re-baselined against the completed DESIGN_V2 pass (theme tokens, redesigned nav/layout, native-dialog
mobile nav, focus system). All batch 1–2 logic fixes survived; tree green (typecheck, 426 tests, build).

- **F-34 — orphaned pages removed.** Deleted `app/(app)/{explore,modules,scorecard}/page.tsx` and their
  exclusive components (`ModulesView`, `PlacesExplorer`, `PrintButton`). `/reports` + `ReportView` kept
  (still linked from the dashboard). No dangling refs; 38→35 routes.
- **F-42 — leftover AI cleanup (partial).** Removed the orphaned `moduleResult.deleteMany(module:
  'analysis')` in the orchestrator refresh path (nothing writes those rows any more), and replaced the
  whole VectorShift section in `.env.example` with a short "no external AI" note (dropped the
  real-looking pipeline id). LEFT (inert, needs coordinated env/migration/test change): the `lib/ai`
  stub files, the `PipelineUsage` model, and `SUPPORTED_AI_PROVIDERS` still listing 'vectorshift'
  (kept so a deploy that still has AI_PROVIDER=vectorshift set doesn't hard-fail). The `analysis`
  payload type is intentionally kept as a legacy-run fallback by the redesign.

**Resolved by the design pass (verified, marked Done in the audit workbook):** F-35 (tab
role/aria-selected/arrow-key handling), F-38 (branded `loading.tsx` + `error.tsx`). Also large
improvement on F-39 (tiny text 63→21 uses via the new type scale) — left open pending a full check.

**426/426 tests, typecheck clean, `next build` compiles (35 routes).** Audit workbook: 13 Done, F-42
In progress. No DB migration.

---

## 2026-09-25 — Audit fixes batch 2 (F-04, F-32, F-33, F-48, F-49, F-50)

- **F-48 — CI.** `.github/workflows/ci.yml` runs npm ci → prisma generate → typecheck → test → build
  on every push and PR (dummy env values; no DB needed).
- **F-49 — migrate on deploy.** Netlify build command is now
  `npx prisma migrate deploy && npx prisma generate && npm run build`, so pending migrations apply
  (via DIRECT_URL) before the new code goes live; a failed migration fails the build.
- **F-50 — build id.** `next.config.mjs` bakes the short COMMIT_REF into `NEXT_PUBLIC_BUILD_ID`; the
  signed-in footer shows `· build <sha>` so you can confirm which build is live (ends the
  "the fix didn't deploy" confusion).
- **F-32 — mobile navigation.** New `components/MobileNav.tsx`: a hamburger in the mobile top bar opens
  a slide-over drawer with the same SidebarNav items + Settings + Logout (closes on route change,
  backdrop, Escape; focus-visible rings). Phones can now reach every screen.
- **F-33 — onboarding tour.** Rewrote the two steps that pointed at the removed `nav-modules` /
  `nav-reports` items; they now describe the per-site tabs and the Final Report / PDF, matching the
  current app.
- **F-04 — pipeline time limit.** `export const maxDuration = 26` (+ force-dynamic) on
  `/api/runs/[id]/run` so a slow first site gets the full platform window instead of being killed
  mid-processing and retried forever. The double POI-cache warm is already idempotent (no-op when the
  area is covered). Cleaned the route's stale AI comments.

**426/426 tests, typecheck clean, `next build` compiles.** Audit workbook updated (6 marked Done).
⚠️ Owner: set `DIRECT_URL` in Netlify env (used by migrate deploy) if not already set.

---

## 2026-09-25 — Audit fixes batch 1 (F-01, F-02, F-03, F-07)

Started on the audit's "do first" list (docs/BSA_Application_Audit.xlsx).

- **F-01 — orchestrator transaction crash.** `lib/modules/orchestrator.ts` loaded the run with
  `findUniqueOrThrow` + `include` (sites/franchisor/intake) → implicit transaction rejected by the
  Neon HTTP adapter. Replaced with `findUnique` (flat select) + null check + separate flat reads for
  sites / franchisor / intake. Same class of bug that broke the old AI report; the pipeline no longer
  risks it.
- **F-02 — report/scorecard transaction crash.** `lib/modules/reportComposer.ts` used
  `findUniqueOrThrow({ include: franchisor })`. Same fix (flat findUnique + separate franchisor read).
  The `moduleResult.findMany({ include: site })` below is left as-is — non-OrThrow findMany+include is
  fine under the HTTP adapter.
- **F-03 — leftover AI endpoint calls.** `RunPipelineButton` and `SteppedIntakeWizard` still POSTed to
  the deleted `/api/analysis-report` after every run (a 404 per site + a fake "Writing analyses…"
  step). Removed both loops and the "writing" state; the Final Report is computed live from module
  results.
- **F-07 — dashboard vs Final Report agreement.** `summariseSite` now takes the site's composite band
  (`candidate_site.verdict`, the same value the dashboard shows) and that DECIDES the Proceed /
  Cautious / No-Go call; the module findings only explain why. Threaded the band through the site page
  → `SiteIntelligenceTabs` → the summary, and through the PDF route. Added an agreement test that the
  Final Report call always matches the scorecard band across the score range.

**426/426 tests (5 new), typecheck clean, `next build` compiles.** Audit workbook updated (these four
marked Done). No DB migration.

---

## 2026-09-25 — GRID brand applied across the app (palette · type · logo)

Applied the official GRID Property Ventures brand guidelines app-wide.

- **Palette (`tailwind.config.ts`):** official hex — Nile Blue `#1C335E`, Midnight `#0E192F`, Muesli
  `#BE8562`, Deep Code `#141545`, Burly Wood `#E2B985`, Iron `#D2D2D2`. Dark theme mapped onto them:
  bg = Midnight, panel = Nile Blue, inset = deep navy `#15254A`, accent/CTA = Muesli, accent-soft =
  Burly Wood, near-white text `#EDF2FB`, muted `#94A3BE`. Status colours (go/caution/nogo, Truth
  Layers) kept functional. Hard-coded old-theme hexes in `globals.css` (inputs, autofill, MapLibre
  popups, grid backdrop) and in the chart/map components (Daypart, Lease, Gaps/Territory maps,
  LocationPicker, AnalysisSequence, FranchiseScreening, reportHtml) remapped to the brand palette.
- **Typography (`app/layout.tsx` + tailwind `fontFamily`):** loaded Cantata One (headings), Poppins
  (body), Judson (serif accent) from Google Fonts with preconnect. `font-heading` = Cantata One,
  `font-body` = Poppins, `font-serif` = Judson.
- **Logo (`components/GridLogo.tsx`):** uses the ACTUAL supplied horizontal logo (waves + "GRID /
  PROPERTY VENTURES"), not a recreation. The artwork has a white background + navy wordmark, so it was
  processed (PIL) into a dark-theme asset `public/brand/grid-logo-dark.png` — white background knocked
  out to transparent and the navy wordmark lightened to `#EDF2FB`, tan waves unchanged — so it reads on
  the navy UI. `GridLogo` renders that image; applied to the sidebar header, mobile top bar and login.
  Original raster kept at `grid-logo-horizontal.png` for light/print. (An earlier SVG wave-mark
  recreation was replaced at the owner's request to use the exact logo.) Branded PDF already used Nile
  Blue + Muesli — unchanged.

**421/421 tests, typecheck clean, `next build` compiles.** No DB change.

---

## 2026-09-25 — REMOVED AI analysis; Final Report is now a deterministic GO/CAUTIOUS/NO-GO summary

Owner decision: AI analysis is not the core product. Removed it entirely and replaced the Final
Report with a deterministic recommendation rolled up from the module figures — which also permanently
kills the VectorShift 502 / transaction / timeout surface (no external call, no implicit transaction).

- **New summariser `lib/modules/siteVerdict.ts` (pure, tested):** `summariseSite(payloads, isPrimary)`
  → `{ classification: proceed|cautious|no_go, label, tone, headline, findings[], keywords[], coverage }`.
  Drivers are the three site-viability modules (Territory, Lease, Daypart); White-Space is
  informational only. Rules: a PRIMARY module reading no-go (or ≥2 no-go) → **No-Go**; ≥2 modules
  covered, zero no-go, positive score, gos ≥ cautions → **Proceed**; else **Cautious**; no data →
  Cautious with an honest headline. Every finding traces to a module figure; no price verdict, nothing
  invented. `tests/unit/siteVerdict.test.ts` (6 cases).
- **Analysis tab (`SiteIntelligenceTabs`):** removed the **Generate analysis** + Regenerate buttons,
  the AI narrative, the poll loop, the schema/AI-check UI. The Final Report card now shows the
  verdict badge (Proceed / Proceed with caution / No-Go), the one-line headline, the findings list
  (keyword: data) and keyword chips. Module sections below are unchanged. **Export site PDF** kept.
- **PDF (`/api/analysis-report/pdf`):** now builds the same deterministic summary from the site's
  module_results (flat reads — no `findUniqueOrThrow`/`include`, so no HTTP-mode transaction) and
  renders it through the existing `AnalysisPdf`. No AI, no "generate first" 409.
- **Deleted (AI is gone):** `app/api/analysis-report/route.ts` (POST/GET), `lib/ai/analysisReport.ts`,
  `lib/ai/vectorshiftProvider.ts`, `lib/ai/enqueue.ts`, `netlify/functions/*` (the async background
  worker), the `netlify.toml [functions]` block, and `docs/ASYNC_ANALYSIS.md`. **Kept:** the module
  verdict-line phrasing (`generateGrounded` → deterministic StubProvider, used by territory-guard /
  lease-benchmark) and the pure helpers `outputCheck` / `mockAnalysis` / `analysisCache` (still tested).
- **Menu trim (same session):** removed **Explore Places**, **All Modules**, **Scorecard** from the
  left rail (`SidebarNav.tsx`); only Workspace (Franchise Screening · Site Dashboard · New Intake) remains.

**421/421 tests, typecheck clean, `next build` compiles.** No DB migration. Env vars `VECTORSHIFT_*`,
`ANALYSIS_BACKGROUND`, `INTERNAL_JOB_SECRET` are no longer used and can be removed from Netlify.

**Note:** the console still showed the SAME bundle hash `fd9d1056…` as before the hydration fix, so
the earlier hotfix was not yet deployed — that is why #418/#423 persisted. Both fixes ship together in
the next deploy.

---

## 2026-09-24 — R-08: Regional QA end-to-end (Cavite + Batangas) — DONE (closes the R-series)

Skills: 08 User Journey QA, 09 Documentation. Verifies the CALABARZON expansion is coherent end-to-end
and permanently guards the province→NCR regression. No new feature code — a regression test + handoff doc.

- **Regression guard (`tests/unit/regionalQa.test.ts`, 12 cases):** walks representative Cavite
  (Bacoor, Imus, Dasmariñas, General Trias, Tagaytay) and Batangas (Batangas City, Lipa, Sto. Tomas,
  Tanauan) sites through the live resolvers — `regionForSite → canonicalCity → inferCorridor →
  psaRegion → corridor key`. Asserts each resolves **entirely in-region**, that no provincial corridor
  is an NCR corridor and the zonal region is **IV-A not NCR** (the pre-R-06 "Bacoor → NCR Las Piñas"
  bug can't return silently), and that NCR (Makati/BGC/Ortigas) is unchanged. Also pins the
  corridor↔traffic-template contract (renaming a registry corridor without updating its template fails).
- **Handoff doc (`docs/qa-history/QA_JOURNEY_FINDINGS_CALABARZON.md`):** the two-part result — wiring
  PASS (done, guarded) vs data (owner-loaded per module) — with a per-module before/after-load table
  showing the honest-degradation behaviour, the guardrail confirmations, and the one-province load
  order (R-02 → R-03 → R-04/05/06/07).
- **412/412 tests, typecheck clean, `next build` compiles.**

**R-series (R-01…R-08) COMPLETE** — Cavite & Batangas are wired through every module; the remaining work
is the owner data loads (each with a loader + README) and then the non-regional backlog (Data/scoring
D-01.., AI I-01.., Architecture A-01.., Ops, Security, UX).

---

## 2026-09-24 — R-07: Malls + traffic seasonality for Cavite/Batangas — CODE COMPLETE (owner data)

Skills: 01 Web/App, 02 Database, 07 Broker. Feeds the Mall Match module and the Daypart &
Seasonality read for provincial sites. No migration (uses existing columns / tables).

- **Malls (`db:load-malls -- --region --file|--url`):** tolerant CSV mapper `lib/geo/mallRow.ts`
  (`mallRowFrom`/`canonicalTier`/`canonicalFootfall`) → existing `loadMalls`. Stamps the region PSA
  code + province (existing `mall_property` columns from R-01), builds geom from lat/lon. A row with
  no name/tier/footfall band is **skipped** (never fabricated). `RawMall` + `loadMalls` extended to
  persist region/province (backward-compatible; NCR json unaffected). The Mall Match query is a
  nearest-by-geom lookup, so a loaded provincial mall is used automatically. README:
  `prisma/data/malls/README.md`.
- **Traffic (`db:load-traffic -- [--region] --file|--url`):** JSON loader (nested seasonal blob)
  → pure normaliser `lib/geo/trafficRow.ts` (`trafficRowFrom`) → upsert on `traffic_corridor`.
  Corridor names match R-06, so the daypart `inferCorridor` lookup resolves them. Ships Projected
  seasonal **templates** `prisma/data/traffic/{cavite,batangas}.template.json` with `aadtRef: null`
  (owner fills from **DPWH ATTAS**). The seasonal shape encodes the province direction vs NCR: Undas
  = province **inflow spike** (not the NCR dip); Holy Week = tourism corridors (Tagaytay–Silang,
  Batangas City port) **peak** while commuter/industrial corridors (Bacoor–Imus, Sto. Tomas–Tanauan)
  **dip**. Base AADT band stays the empirical part (owner-supplied). README:
  `prisma/data/traffic/README.md`.
- **Guardrail:** footfall bands + seasonal multipliers are modelled (Projected/Assumed), never live
  counts; nothing is fabricated for a bare row. **400/400 tests** (new: `mallRow` 6, `trafficRow` 5),
  typecheck clean, `next build` compiles.

**⚠️ ACTION REQUIRED (owner, any time):** (1) mall roster CSV → `npm run db:load-malls -- --region=cavite
--file=prisma/data/malls/cavite.csv` (and batangas). (2) Review the traffic templates, fill `aadtRef`
from DPWH ATTAS, then `npm run db:load-traffic -- --region=cavite --file=prisma/data/traffic/cavite.template.json`
(and batangas). Until loaded, a provincial site's Mall Match reads "no mall data" and its seasonality
falls back to the vertical term-time note only.

---

## 2026-09-24 — R-06: Provincial lease corridors + comps loader for Cavite/Batangas — CODE COMPLETE (owner CSV)

Skills: 01 Web/App, 02 Database, 07 Broker. Gives the Lease Benchmark a real corridor read for
Cavite/Batangas sites (rent range, median, percentile, negotiating room) instead of only the
BIR-zonal indicative band. Guardrail intact — comps are broker/published, never invented; BSA
reports *position vs the corridor*, never a price verdict (RA 9646 framing unchanged).

- **Corridors (config, `lib/geo/regions.ts`):** Cavite → `Bacoor–Imus`, `Dasmariñas–General Trias`,
  `Tagaytay–Silang`; Batangas → `Sto. Tomas–Tanauan`, `Lipa`, `Batangas City`. Adding/splitting a
  corridor is a registry edit, not code.
- **Region-first corridor inference:** `inferCorridor` now scans the site's own region first (by LGU),
  so a Cavite/Batangas site hits its provincial corridor instead of a border NCR corridor
  (Bacoor → `Bacoor–Imus`, not NCR `Las Piñas`). **NCR/Davao behaviour unchanged** — their region is
  scanned first exactly as before; a shared-token NCR site (e.g. Zapote) still resolves to NCR.
- **Loader:** `prisma/loadLeaseCsv.ts` (`db:load-lease -- --region --file|--url`) → tolerant mapper
  `lib/geo/leaseRow.ts` (`leaseRowFrom`/`canonicalCorridor`/`canonicalFormat`) → existing `loadLease`
  (idempotent per format+corridor). Maps an LGU/barangay to its corridor, normalises the store format,
  strips ₱/commas, defaults a broker point to `assumed`, and **drops any row with no numeric term**
  (never fabricates a comp). Unit-tested (`tests/unit/leaseRow.test.ts`, 9 cases; `regions.test.ts`
  updated for the new R-06 behaviour).
- **Docs:** `prisma/data/lease/README.md` (corridors, sourcing — Colliers/Leechiu/KMC CALABARZON
  briefs + listings + mall GLA, CSV columns, ≥5 comps/corridor target). CSVs git-ignored.
  **No migration.** **389/389 tests, typecheck clean, `next build` compiles.**

**⚠️ ACTION REQUIRED (owner, any time):** assemble Cavite/Batangas comps into a CSV (see the README)
→ `npm run db:load-lease -- --region=cavite --file=prisma/data/lease/cavite.csv` (and batangas). Until
loaded, a provincial site still gets the BIR-zonal indicative band (R-05); once loaded it gets the
full corridor benchmark.

---

## 2026-09-24 — R-05: BIR zonal values for Cavite/Batangas + region-aware zonal lookup — CODE COMPLETE (owner CSV)

Skills: 02 Database, 07 Broker. Makes the Lease zonal cross-check and the Land zoning screen work
provincially. Zonal stays a TAX-REFERENCE FLOOR only (guardrail unchanged).

- **Region-aware lookup (wire-up):** `lib/modules/leaseBenchmark.ts` `resolveZonalBand` and
  `lib/modules/p2p3Modules.ts` land-zoning now use `canonicalCity` + the region's PSA code
  (`getRegion(...).psaRegion`) instead of hard-coded `canonicalNcrCity` / `region:'NCR'`. NCR behaviour
  identical (ncr → 'NCR', same city strings); Cavite/Batangas → 'IV-A'.
- **Loader:** `prisma/loadZonalCsv.ts` (`db:load-zonal -- --region --file|--url`) parses a BIR zonal CSV
  → `RawZonal[]` → existing `loadZonal` (idempotent natural key). Pure tolerant mapper
  `lib/geo/zonalRow.ts` (`zonalRowFrom`, `zonalRegionValue`): canonicalises the LGU to the registry, stamps
  the PSA region, accepts single-value or low/high, strips ₱/commas. Unit-tested
  (`tests/unit/zonalRow.test.ts`, 5 cases).
- **Docs:** `prisma/data/zonal/README.md` (BIR RDO 54A/54B/58/59, CSV columns, load commands). CSVs
  git-ignored. **378/378 tests, typecheck clean, `next build` compiles.**

**⚠️ ACTION REQUIRED:** no migrate. Data load (any time): flatten the BIR schedules for Cavite (RDO 54A/54B)
and Batangas (58/59) to a CSV (see the README) → `npm run db:load-zonal -- --region=cavite --file=…` (and
batangas). Then a provincial Lease benchmark shows the zonal band + cross-check and Land zoning resolves.

**Also this session:** made the R-03 tiled Overpass sweep resilient — a tile that 504s/times out now SPLITS
and retries smaller; partial results are saved and only fully-clean start-tiles are checkpointed, so a
re-run resumes and completes (the owner hit Overpass 504s on the free servers). `establishmentsInTiles` gains
`failedTiles`; start-tiles default 0.05°.

---

## 2026-09-24 — R-04: PSA barangay demographics for Cavite/Batangas — CODE COMPLETE (needs migrate + owner CSV)

Skills: 02 Database. Gives provincial sites a real population signal (Site Fit demand, Daypart, White-Space)
so confidence stops defaulting to Low there. NO fabricated population (guardrail): only real census loads.

- **Schema:** `demographic_cell.geom` widened Polygon → **MultiPolygon** so it can hold the real barangay
  boundary (from admin_boundary). Migration `20260923000006_demographic_multipolygon` (ALTER … USING
  ST_Multi, idempotent, re-creates GiST). Existing NCR loader (`lib/ingest/loaders.ts`) now ST_Multi's its
  600 m circle to match.
- **Loader:** `prisma/loadDemographics.ts` (`db:load-demographics -- --region --file|--url`) — parses a
  barangay-population CSV, upserts `demographic_cell` on PSGC (population **Verified**; income/daytime
  Assumed only when present), and copies each barangay's `geom` from admin_boundary. Reports rows with no
  population column or no matching boundary. Tolerant column mapping (pure `lib/geo/demographicsRow.ts`) +
  a dependency-free CSV parser (`lib/util/csv.ts`), both unit-tested (`tests/unit/demographicsRow.test.ts`,
  7 cases). `--url` allows a one-command load from a direct CSV link.
- **Docs:** `prisma/data/demographics/README.md` (HDX COD-PS `phl_admpop_adm4_2020.csv` + PSA FOI sources,
  column table, load order). CSVs git-ignored. DATA_DICTIONARY updated.
- **Verified (cloud):** typecheck clean, **373/373 tests**.

**⚠️ ACTION REQUIRED:** `npx prisma migrate deploy`; load boundaries first (R-02 `db:fetch-boundaries`), then
download a barangay-population CSV (HDX/PSA — see the README) and
`npm run db:load-demographics -- --region=cavite --file=… | --url=…` (and batangas). HDX has no stable
auto-URL, so this is a download step (the loader auto-detects the population/PSGC columns).

---

## 2026-09-24 — R-03: Tiled Overpass sweep (no truncation) — CODE COMPLETE (no migrate; pure code)

Skills: 02 Database, 06 Research. Fixes the silent truncation where one bbox query per vertical capped at
`out center N` dropped establishments in dense areas — worse at province scale.

- **Pure tiling** `lib/geo/tiling.ts`: `subdivide` (grid), `quadrants` (4-split), `bboxHeightDeg`,
  `bboxCentre`, `bboxKey`. Unit-tested (`tests/unit/tiling.test.ts`, 6 cases).
- **`osmService.establishmentsInTiles(vertical, bbox, opts)`** — splits the region into ~0.08° start-tiles;
  any tile returning at the cap is split into quadrants and retried down to ~0.02°; dedups by osm_id.
  DB-free: the caller drives persistence/resume via `shouldProcess(tile)` + `onStartTileDone(tile, places)`.
- **`prisma/ingestOsm.ts`**: the DEFAULT competitor sweep now tiles (complete). Each start-tile is
  checkpointed in `poi_coverage` (cellKey `bulk:<bbox>`, source='bulk'); an interrupted run resumes,
  `--force` re-sweeps. `--quick` keeps the fast single-bbox smoke. Per-tile logging (tiles/splits/count).
  Region + tiled examples in the header; brand pull unchanged.
- **Verified (cloud):** typecheck clean, **366/366 tests**.

**⚠️ ACTION REQUIRED:** none for deploy (no schema change). To populate provinces (any time):
`npm run db:ingest:osm:cavite` / `:batangas` (complete tiled sweep; minutes, polite). After R-02 boundaries
are loaded, run `npm run db:tag-boundaries` to attach barangays to the new POIs.

---

## 2026-09-24 — R-02: Admin boundary polygons + point-in-polygon tagging — CODE COMPLETE (needs migrate + owner data load)

Skills: 02 Database. Real barangay/city/province for every point, replacing the 600 m circles / bbox tags.

- **Schema:** new `admin_boundary` model (psgc_code pk text, level, name, parent_psgc, region,
  geography(MultiPolygon) geom, Verified). `psgc_code` added to `poi`, `candidate_site`, `mall_property`.
  Migration `20260923000005_admin_boundary` (table + GiST/level/region/parent indexes + psgc columns;
  additive, idempotent; geom added via DO-block since PostGIS types aren't expressible inline).
- **Loader:** `prisma/loadBoundaries.ts` (`db:load-boundaries -- --region --level --file`) reads GeoJSON
  (converted from PSGC shapefiles), upserts on psgc_code, sets geom via `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON,4326))::geography`.
  Tolerant property mapping in pure `lib/geo/boundaryFeature.ts` (adm4_psgc / ADM4_PCODE / psgc … variants);
  prints unmapped keys so the lists can be extended.
- **Backfill:** `prisma/tagByBoundary.ts` (`db:tag-boundaries [-- --all]`) — LATERAL `ST_Intersects` (geography,
  GiST) sets barangay/city/province/psgc on poi/candidate_site/mall_property. Three explicit tagged-template
  UPDATEs (no `$…Unsafe`).
- **Runtime:** `lib/geo/adminBoundary.ts` `resolveAdminBoundary(lat,lon)` (fault-tolerant — missing table
  never breaks intake); intake route now stamps real barangay/city/province/psgc on each new site when
  boundaries exist, else keeps the user's values + coarse region.
- **Docs:** `prisma/data/boundaries/README.md` (git-lfs clone + ogr2ogr per-province + load order + tag).
  `.geojson` git-ignored. DATA_DICTIONARY updated. Tests: `tests/unit/boundaryFeature.test.ts` (6 cases).
  **360/360 pass, typecheck clean.**

- **Auto-downloader (added after owner hit the missing-file error):** `prisma/fetchBoundaries.ts`
  (`db:fetch-boundaries -- --region=cavite|batangas`) pulls ready-made GeoJSON (province → cities →
  barangays) from faeldon/philippines-json-maps (MIT, PSGC Q4-2023) and loads it — NO GDAL, NO shapefile
  clone. Verified the exact URL/property schema live (adm2/adm3/adm4_psgc, Cavite=402100000,
  Batangas=401000000, region CALABARZON=400000000). Registry gained `psgcRegionCode` + `psgcProvinces`
  (Cavite/Batangas). Shared upsert refactored to `lib/geo/boundaryUpsert.ts` (used by both the file loader
  and the fetcher). `loadBoundaries` now prints a friendly "run db:fetch-boundaries" hint on a missing file.

**⚠️ ACTION REQUIRED:** `npx prisma migrate deploy`, then the easy path:
`npm run db:fetch-boundaries -- --region=cavite` · `--region=batangas` · `npm run db:tag-boundaries`.
(Manual ogr2ogr path still documented for other vintages / regions without a PSGC mapping.)

---

## 2026-09-24 — R-01: Region registry + region-aware schema — CODE COMPLETE (needs migrate)

First approved backlog item; foundation for R-03/R-05/R-06/R-07/R-08/A-02/U-02. Skills: 02 Database, 01 Senior Web.

- **New `lib/geo/regions.ts`** — one registry for ncr, davao, cavite, batangas: bbox, Overpass area names,
  warm centres, lease corridors and LGU canonicalisers. Pure/client-safe. Adding a province = a registry
  entry + its data, not code changes. Helpers: `getRegion`, `listRegions`, `REGION_KEYS`, `regionForPoint`
  (coarse bbox), `canonicalCity` (LGU + region), `regionForSite` (LGU name first, else coordinate),
  `inferCorridor`, `corridorsForRegion`.
- **`inferCorridor` and `canonicalNcrCity` refactored to consume the registry** — behaviour identical for
  NCR/Davao (ported token lists verbatim; Bacoor still → Las Piñas corridor until R-06). `leaseMath` imports
  from the registry and re-exports both, so every existing importer/test is unchanged.
- **Schema:** `region` + `province` on `poi`, `candidate_site`, `mall_property` (+ region indexes). Migration
  `20260923000004_region_columns` (additive, idempotent, bbox backfill of existing NCR/Davao rows).
- **Tagging:** intake write sets `candidate_site.region` via `regionForSite`; `normalizePoi` and the
  on-demand cache (`poiCache.persistPois`) set `poi.region` from the coordinate; province stays NULL until
  R-02 gives real polygons.
- **Ingest:** `prisma/ingestOsm.ts` gains `--region=<key>` (bbox from the registry; defaults ncr; prints a
  note that the single-bbox sweep truncates dense verticals — R-03 is the complete tiled path). New scripts
  `db:ingest:osm:cavite` / `:batangas`.
- **Tests:** new `tests/unit/regions.test.ts` (20 cases: NCR/Davao unchanged, Cavite/Batangas resolve,
  regionForPoint/regionForSite, corridors). **354/354 pass, typecheck clean, `next build` compiles.**

**⚠️ ACTION REQUIRED:** `npx prisma migrate deploy` (applies region columns + backfill). No data load needed
for R-01; Cavite/Batangas data arrives in R-02→R-07.

---

## 2026-09-23 — Improvement backlog workbook (for owner approval) — DOC ONLY

`docs/BSA_Improvement_Backlog.xlsx` — 36 open items (11 P1 / 19 P2 / 6 P3) across Regional expansion,
Data & scoring, AI, Architecture, Operations, Security, UX; each with current state, how to improve,
implementation needed, desired outcome, priority, effort, owner skill, dependency and an Approval column
(Approve/Defer/Reject/Discuss). Plus a 12-step **Cavite–Batangas data plan** (Overpass tiled sweeps,
PSGC boundaries, PSA 2020 population, BIR RDO 54A/54B/58/59, broker lease comps, DPWH AADT → Neon),
Overpass QL templates, a data-coverage matrix and sources. Findings from code research: ingestOsm uses one
NCR bbox per vertical capped at `out center 600` (truncation); POIs stored with city/barangay NULL;
demographic geoms are 600 m circles; mobile layout has no navigation; Bacoor maps to the Las Piñas corridor.
No application code changed. **Next:** owner marks Approval; approved P1s become the next batch.

---

## 2026-09-23 — Agency: Skill 12 (Orchestration & Delivery Lead) written

`3 - Skills/12 - Orchestration and Delivery Lead/SKILL.md` was an empty folder. Written in the house
format (Identity / When routed / How you work / Standards / Outputs / Handoffs / Guardrails), encoding the
workflow proven in fix batches 1–5: reconstruct state (Master Instruction → PROJECT_MEMORY → WORKLOG →
git), risk-ordered shippable batches, ask only user-owned decisions, verify (typecheck/tests/build with the
cloud-sandbox Prisma recipe), log WORKLOG + PROJECT_MEMORY after every batch, and always end with
PowerShell-safe git + database commands. No application code changed.

---

## 2026-09-23 — Fix Batch 5: Hygiene + handoff docs, and a live-site hotfix — CODE COMPLETE

Skills loaded: 01 Senior Web, 09 Documentation, 04 Security, 10 AI Systems. Batch 4 confirmed pushed (`fb4e312`).
Owner decisions (asked): keep BOTH reports (clearly labelled) · reports generated ON DEMAND (no storage) ·
RETIRE the four hidden standalone pages.

**Hotfix — owner-reported errors on the live site**
- React #418/#423 (hydration mismatch) on the site page: `new Date(...).toLocaleString()` rendered UTC on
  Netlify vs the viewer's zone in the browser. Now `manilaShortStamp` (fixed UTC+8, ICU-free) in
  `SiteIntelligenceTabs` (Analysis "generated" line) and `VersionHistory`; the PDF date uses
  `manilaLongStamp` (it printed UTC).
- Repeated 502 from `/api/analysis-report`: most likely the Batch 2/4 migrations not yet applied on Neon —
  the post-VectorShift usage-log insert hit the new columns, threw, and discarded a paid write-up. Usage-log
  writes and the regenerate-cap count are now NON-FATAL; Prisma P2021/P2022 map to `db_migration_pending`;
  the API returns a short safe reason code (`error.details[reason]`) and the Analysis tab shows it
  (`function_timeout` when Netlify's own timeout page comes back). No provider bodies are exposed.
- `/api/maptiles` 503 console noise: "Google disabled" now answers `200 { enabled:false }`; maps already fell
  back to OSM/CARTO.

**Reports (both kept, on demand)**
- `POST /api/reports` composes + records the run report row only (`recordReport`, `storage_key` NULL) — no
  file write, no signed URL. `/reports` page + `ReportView` updated; titled **"Run Report (all sites)"**;
  dashboard button "Run report (all sites)"; Analysis tab button "Export site PDF".
- `/api/reports/full` now accepts **POST** (form body) — client name/phone/email no longer in URLs/logs;
  `ReportDownloadModal` submits a hidden form to a new tab. GET kept without cover details.

**Retired → `_to_delete/retired_2026-09-23/`** (git-ignored; owner may delete the whole `_to_delete` folder):
pages `/territory-guard`, `/lease-benchmark`, `/daypart`, `/whitespace`; components `IntakeWizard`,
`TriangulationOverlay`, `TerritoryGuardView`, `LeaseBenchmarkView`, `WhiteSpaceGrid`; root scripts
`repro_*`, `_x.mjs`, `_check_cset.mjs`, `verify_manila*.ts`, `prisma/seed.ts.bak`; local `bsa_dev.dump`.
API routes `/api/territory-guard` + `/api/lease-benchmark` KEPT (auth-gated; lease is used below).
- **Lease tab now saves the asking rent** ("Use this rent in the site score" → `POST /api/lease-benchmark`
  → value score + composite recompute + page refresh). The retired page had been the only writer, so
  without this Lease could never count in the composite. Proxy-corridor flag is preserved on save.
- Removed White-Space v1 `rankWhiteSpace` + types + its 3 tests. Fixed the pre-existing TS cast in
  `tests/unit/analysisContext.test.ts:117` → **typecheck fully clean (0 errors)**.

**Docs:** README rewritten (current stack, run/deploy, scripts, safe-seed warning); NEW `docs/HANDOFF.md`
(journey + run sequence diagrams, decisions table, prioritised limitations, pre-production checklist);
`SECURITY_POSTURE.md` (hardening added + current open items); `API_REFERENCE.md` (reports, maptiles,
analysis reason codes); 16 QA reports moved to `docs/qa-history/`.

**Verified (cloud):** `tsc --noEmit` 0 errors · 331/331 tests · `next build` succeeds (all routes compile).

**⚠️ ACTION REQUIRED:** `npx prisma migrate deploy` (if not yet done — fixes the 502s) → push → after deploy,
retry the Analysis tab; if it still fails, the red box now shows `[reason: …]` — send it over.

---

## 2026-09-23 — Fix Batch 4: Truth Layer honesty + Grid guardrails — CODE COMPLETE (needs migrate + methodology reseed + re-run)

Skills loaded: 07 PH Broker (guardrail wording), 10 AI Systems, 02 Database. Batches 2+3 confirmed pushed (`c5ccfaf`).

**Guardrails**
- New `lib/truth/guardrailCopy.ts` — single source for guardrail wording: positional lease labels
  (`Below corridor median / Within corridor range / Above corridor median`), `LEASE_POSITION_EXPLAINER`,
  `ZONAL_FLOOR_NOTE`, `BROKER_DISCLAIMER_SHORT/LONG` (RA 9646), `PRICE_VERDICT_PATTERNS`.
- **No price verdicts:** "Above market — likely overpaying" / "Below market — favourable" / "a competitive
  rate" / "a favourable rate" removed from SiteIntelligenceTabs, LeaseBenchmarkView (+ tooltip),
  analysisContext (what the AI reads), methodology chunk `method-lease`, scorecard demo note. Flag
  `overpaying_base_rent` → `base_rent_above_corridor_median`. Above-median now amber, not red.
- **RA 9646:** short disclaimer footer on every signed-in page (`app/(app)/layout.tsx`); long form on the
  Analysis PDF footer and the HTML report cover; stated in the AI schema's GUARDRAILS line.
- **BIR zonal = tax-reference floor** wording on the Analysis tab zonal row, the AI schema line and the
  Analysis tab footer (LeaseBenchmarkView already had it).

**Truth Layer**
- Demographics: `normalizeDemo` honoured nothing and stamped `verified`; now uses the source row's label
  (all 296 are `assumed`), default `assumed`. Migration `20260923000003_truth_layer_fixes` relabels stored rows.
  The old unit test that asserted `verified` was encoding the bug → updated.
- Site Fit demand truth now read from the summed rows (was forced Verified). Competition-pillar coverage
  check is LOCAL (any POI within 2 km) — was a global `poi.count()`.
- Lease `truth.comps` = weakest comp row (was hard-coded Verified; 59/80 comps are Assumed); lease-benchmark
  route facts use it.
- Territory own-branch overlap truth = weakest truth of the outlets used (typed outlets are Assumed; was
  hard-coded Verified).
- AI schema + Analysis tab use each payload's per-field truth; missing values print "—" instead of a
  fabricated 0 (overlap, saturation, cannibalization, window match, zonal band, scanned areas).
- Lease with no matching corridor: flag `corridor_default_fallback`, row → Projected, shown on the Lease tab
  and in the AI schema as a proxy (was a silent Quezon City benchmark).

**AI output check** — new pure `lib/ai/outputCheck.ts`: every number in the write-up must trace (incl.
rounding) to the schema + retrieved reference; price-verdict phrases detected. Stored as `check` on the
analysis payload, flag `ai_output_check_failed`; amber "Check before sharing" box on the Analysis tab and a
line on the PDF. Warning, not a block. VectorShift now receives schema + interpretation reference
(`VECTORSHIFT_SEND_REFERENCE=0` reverts); retrieved chunk ids stored on every path.

**Scoring carry-overs from Batch 3**
- Mall: nearest mall only if ≤ 3 km (else `no_mall_nearby`, unscored). Was any distance.
- Daypart all-day: `100 − 2·|50 − share|` (full range; was floored at 50). No catchment data → unscored.
- Land zoning: canonical NCR city (`canonicalNcrCity`); a city outside zonal coverage = unknown, not a fail
  (used to cap land at 25).
- Informal: uses the concept-matched competitor count from the orchestrator (competitorsNear max 20 → 40);
  untyped fallback flagged `informal_untyped_count`.

**New script:** `npm run db:seed-methodology` — refreshes ONLY the methodology corpus (safe on Neon). Do not
use `db:seed` on a shared DB (it resets demo intakes/outlets and sample lease comps).

**Verified (cloud):** 334/334 tests (new `tests/unit/guardrails.test.ts` 12 cases + daypart case), typecheck
clean except the known pre-existing cast at `tests/unit/analysisContext.test.ts:117` (Batch 5).

**⚠️ ACTION REQUIRED:** `npx prisma migrate deploy` → `npm run db:seed-methodology` → redeploy → **↻ Re-run
analysis** on runs you care about (labels, scores and write-ups update only on re-run). Optionally add one
line to the VectorShift prompt: "An INTERPRETATION REFERENCE may follow the schema — use it only to understand
the fields; cite figures only from the schema."

---

## 2026-09-23 — Fix Batch 3: Scoring + pipeline integrity — CODE COMPLETE (needs migrate + re-run)

Skills loaded: 02 Database, 01 Senior Web, 03 API, 04 Security. New file `PROJECT_MEMORY.md` (current-state
snapshot, rewritten after every batch — read it first in a new thread).

- **Confidence no longer always Low.** Old rule: ≥34% Projected rows → Low, and Territory/Daypart/
  White-Space are always Projected. New evidence confidence in `lib/modules/scorecard.ts`
  (`siteEvidenceScore`, `evidenceBand`, `runEvidenceConfidence`): decision-weighted Truth Layer values
  (V 1 · A 0.7 · P 0.35 · missing / unscorable Site Fit 0), High ≥ 0.75, Medium ≥ 0.5, −1 band for
  on-ground flags or failed modules. Used by the pipeline finalize; the dashboard and AI write-up now
  show the run's stored confidence (dashboard's own copy of the old rule is now legacy fallback only).
- **Lease score fixed.** Stored as a VALUE score `leaseValueScore = 100 − percentile` (was the raw
  percentile, so pricier rent RAISED the composite). Pipeline leaves lease unscored (no asking rent);
  `POST /api/lease-benchmark` now calls new `recomputeSiteComposite()` so entering an asking rent updates
  the dashboard/scorecard immediately.
- **Pipeline integrity** (`orchestrator.ts` main loop rewritten):
  - per-module isolation (`attempt()`): one failing module no longer skips the rest; failures go to new
    `candidate_site.pipeline_error` (no more sentinel row overwriting a good Territory result);
  - resume keyed on new `candidate_site.analyzed_at` (any single row used to mark a site done);
  - errors outside a site mark the run `failed` (never stuck `analyzing`); all-empty run → `failed`;
  - `runPipeline(runId, { refresh })` recomputes a finished run and drops stale AI write-ups.
- **Stale scores cleared on re-run:** `?? undefined` → `?? null` in siteFit/p2p3/lease persist.
- **Outlet leak closed:** new `outlet.intake_submission_id`. Typed outlets belong to their intake;
  Territory Guard, White-Space, the site map, the Territory page and intake prefill see only the reference
  network + THIS run's outlets. `places.ts` re-ingest no longer deletes user-typed outlets.
- **Intake versioning:** `parentIntakeId` must belong to the user (or staff) — no attaching to another
  user's lineage.
- **Dashboard:** "Re-run analysis" button (`RunPipelineButton`, sends `refresh` then rewrites analyses per
  site); per-site "Some modules did not complete" alert; AI row excluded from truth mix.
- N+1 removed in `buildScorecardsForRun`. Migration `20260923000002_pipeline_integrity` (additive; backfills
  `analyzed_at` for existing analysed sites, carries old sentinel errors to `pipeline_error`, links existing
  typed outlets to their intake by creation time ≤5 min after the intake).
- Docs: `DATA_DICTIONARY.md` (new columns + pipeline_usage). Tests: new `tests/unit/scoringIntegrity.test.ts`
  (13 cases). **320/320 pass, typecheck clean** (cloud).

**⚠️ ACTION REQUIRED:** `npx prisma generate` → `npx prisma migrate deploy` → redeploy → open an existing run
and click **↻ Re-run analysis** (old runs keep old scores/confidence until re-run).

**Noted, not changed (Batch 4/5 candidates):** mall scored against the nearest mall at ANY distance;
daypart `allday` match can't go below 50; land zoning compares raw city strings; informal counts every
competitor POI regardless of concept; White-Space scans every POI per site (perf).

---

## 2026-09-23 — Fix Batch 2: AI runtime (timeouts, double-billing, safe errors) — CODE COMPLETE (needs migrate)

Skills loaded: 10 AI Systems, 03 API, 04 Security. Owner confirmed Batch 1 pushed; GitHub history
verified clean of `bsa_dev.dump` (only local `refs/original` backups still reference it).

- **Run route no longer waits on AI.** `app/api/runs/[id]/run` only runs the time-boxed pipeline.
  The old `Promise.all` of live VectorShift calls (45s each) inside that request is gone.
- **One site per request.** When the run completes, `SteppedIntakeWizard` calls
  `POST /api/analysis-report` for each site sequentially (non-fatal). The Analysis tab generates
  on demand for anything missing.
- **Per-site lock = no double-billing.** `lib/ai/analysisReport.ts` rewritten: the `analysis`
  module_result row is cache AND lock (`status: ready|generating`, `lockId`, `startedAt`). Claims via
  create (P2002 = lost race) or a conditional JSON-path update; abandoned claims expire after 90s
  (`lib/ai/analysisCache.ts`, pure). On failure the previous report is restored or the placeholder
  removed. Finished text is written only while the lock is still ours.
- **Regenerate** button on the Analysis tab; capped at 3 per site per 24h on the live provider
  (`pipeline_usage.trigger='regenerate'`) → 429.
- **Read-only endpoints:** new `GET /api/analysis-report` (status for polling, never bills). The tab
  polls it every 4s while another request is generating. `GET /api/analysis-report/pdf` NEVER
  generates any more (409 if not ready).
- **Safe errors:** `AiGenerationError(code, detail)` in `vectorshiftProvider.ts`; `detail` (may hold the
  provider's response body) goes to server logs only. Clients get generic 502/503 messages.
- **Timeouts:** VectorShift default timeout 45s → 24s; `maxDuration = 26` on the analysis route.
- **Strict provider config:** `aiProviderName()` in `lib/ai/index.ts` accepts only `stub|vectorshift`;
  a typo now throws instead of silently shipping echoed stub text. Dead `anthropic` env line removed.
- **Usage log:** `pipeline_usage` gains `status`, `error_code`, `latency_ms`, `trigger` + index
  (migration `20260923000001_pipeline_usage_status`, additive). Failed/timed-out calls are logged too.
- **Orchestrator:** the `analysis` row is excluded from "site done" detection and from the run
  confidence roll-up (AI narrative is not evidence).
- Docs: `docs/API_REFERENCE.md` updated (auth limits, admin roles, run route, analysis endpoints).
- **Verified (cloud):** typecheck clean; 308/308 tests (new `tests/unit/analysisRuntime.test.ts`, 9 cases).

**⚠️ ACTION REQUIRED (owner):** `npx prisma generate` → `npx prisma migrate deploy` (applies BOTH Batch 1
and Batch 2 migrations) → check the Netlify function timeout (Site configuration → Functions). If it is below
26s, lower `VECTORSHIFT_TIMEOUT_MS` to ~2s under it → redeploy → submit one intake and confirm
the Analysis tab shows the report (or "Analysing…" then the report).

**Still open (Batch 4):** the VectorShift path still ignores the retrieved interpretation chunks, and
nothing checks the model output for invented numbers or price-verdict wording.

---

## 2026-09-23 — Fix Batch 1: Security hardening — CODE COMPLETE (needs migrate on neon)

Skills loaded: 04 Security, 03 API, 02 Database.

- **Admin routes role-gated:** `reconcile-composites` + `warm` → admin only; `data-stats` → staff.
  `warm` body now Zod-validated (PH bounds, caps). New helpers `isAdmin`/`isStaff` in `lib/auth/auth.ts`.
- **Secret fails closed:** new `lib/auth/secret.ts` (`authSecret()`, `isDeployed()` = NETLIFY/VERCEL/
  BSA_REQUIRE_SECRET). Missing/short AUTH_SECRET on a deployment now throws; fallback is local-only.
  `lib/storage/signtoken.ts` uses the same secret, domain-separated (`storage:` prefix).
- **Demo logins locked on deployments:** `isMockAuth()` false when deployed unless
  `BSA_ALLOW_DEMO_LOGINS=1`; admin/analyst demo accounts never work when deployed.
- **Brute-force protection:** `lib/auth/rateLimit.ts` — DB-backed (counts `audit_log` rows, works across
  serverless instances, no new infra). Login: 5 fails/account + 20 fails/IP per 15 min → 429 +
  Retry-After. Register: 5/IP/hour. Failed logins are now audited (IPs stored SHA-256 hashed).
  `errors.tooMany` added to `lib/api/respond.ts`.
- **Password minimum 6 → 10** for new/changed passwords (schemas + login/register + change form). Existing
  passwords still sign in.
- **Security headers** in `next.config.mjs`: CSP (self + CARTO/OSM tiles + Google Fonts, blob workers,
  frame-ancestors none), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS (prod),
  `poweredByHeader:false`. Escape hatch `BSA_CSP_REPORT_ONLY=1`.
- **Brand privacy (schema):** `Franchisor.createdByUserId` + migration `20260923000000_franchisor_creator`
  (additive, idempotent, BACKFILLS creators of existing independent/intake-added brands). Rules in
  `canSeeFranchisor` / `visibleFranchisorWhere`. Applied to GET/POST `/api/franchisors`,
  `/api/franchisors/[id]` (404 for others' private brands), `/api/intake` (independent brands now
  private to creator), and the intake page brand list. POST no longer hands back another user's brand id.
- **Stale duplicate route removed:** `app/franchisors/route.ts` (live at `/franchisors`) moved to
  `_to_delete/stale_routes/`. Its newer `verticalFromRequirements` logic was merged into `/api/franchisors`
  (the UI calls that one, so the template-vertical filter was previously dead).
- **DB dump:** `bsa_dev.dump` untracked (`git rm --cached`, file kept locally) + `*.dump` gitignored.
  **GitHub repo is PUBLIC and the dump (with password hashes) is in history** — owner must make repo
  private and purge history (see open items). Removed a stale `.git/index.lock` left by the review session.
- **Tests:** new `tests/unit/authSecurity.test.ts` (16 cases). Full suite 284/284 pass; app typecheck clean
  (cloud, with generated Prisma types).

**⚠️ ACTION REQUIRED (owner):**
1. GitHub → make `bsa-version-3` private; then purge `bsa_dev.dump` from history (commands given in chat)
   and rotate passwords of any real accounts in that dump.
2. `npx prisma generate` → `npx prisma migrate deploy` (applies franchisor_creator to neon).
3. Netlify env: confirm `AUTH_SECRET` (32+ chars) is set — a deploy without it now refuses to sign in.
4. Browser smoke test: log in, open a site map (CSP) — if tiles/fonts blocked, set `BSA_CSP_REPORT_ONLY=1`.

**Open (not in this batch):** outlets typed in an intake for a SHARED catalog brand are written under
that shared franchisor → they leak into other users' Territory Guard for the same brand (needs outlet
ownership — Batch 3). Tokens not revocable before 8h expiry (dev-team item). Nonce-based CSP (dev-team).

---

## 2026-09-23 — State reconstruction + full code review (READ-ONLY, no code changed)

Reviewed Master Instruction, WORKLOG, PROJECT_MEMORY_EXPORT (stale, 2026-08-10) and the whole app.
HEAD = `85e206c` (branded PDF export + Site Report nav dropped) — that commit was NOT logged before this entry.
Pure unit tests: 221/221 pass in cloud (4 Prisma-dependent test files need `prisma generate` locally).
Folder `3 - Skills/12 - Orchestration and Delivery Lead` is EMPTY (no SKILL.md).

Top findings (fix candidates, in priority order):
1. SECURITY — `/api/admin/*` only checks login, no admin role (reconcile-composites mutates all tenants).
2. SECURITY — `bsa_dev.dump` (contains app_user password hashes) is tracked + pushed to GitHub.
3. SECURITY — no rate limit on login/register; hard-coded AUTH_SECRET fallbacks (auth.ts, signtoken.ts); no security headers.
4. RUNTIME — `runs/[id]/run` awaits VectorShift for all sites (45s timeout each) after the 5.5s-budgeted pipeline → likely Netlify timeout.
5. SCORING — run confidence is effectively always Low (territory/daypart/whitespace always Projected ≥34%).
6. SCORING — lease never scores in pipeline (`siteTerms: {}`); when scored via /api/lease-benchmark the percentile isn't inverted.
7. PIPELINE — error sentinel overwrites the territory row; any single module row marks a site "done" on resume; `failed` status never set.
8. TRUTH LAYER — demographics forced to Verified (source is Assumed); lease comps labelled Verified (59/80 Assumed); `?? 0` renders missing data as real zeros in analysis context.
9. GUARDRAILS — "Above market — likely overpaying" label contradicts no-price-verdict; RA 9646 absent everywhere; no AI output validation.
10. HYGIENE — dead code (IntakeWizard, TriangulationOverlay, rankWhiteSpace v1, pgvector never written), repro_*/verify_* scripts in root, local FS storage on Netlify, two report systems (/reports + Analysis PDF).

Next: user to pick which findings to fix first.

---

## 2026-08-26 — AI Analysis via VectorShift pipeline (live provider) — CODE COMPLETE (needs env + migrate)

Wired the Analysis Report to a VectorShift pipeline (Input → Anthropic → Output). Prompts live INSIDE
the VS pipeline (System Instruction + Prompt, v3, in 3 - Skills/10 - AI Systems Engineer/); the app only
ships the SCHEMA text and stores the response.

- **Provider:** `lib/ai/vectorshiftProvider.ts` — POST https://api.vectorshift.ai/v1/pipeline/{id}/run,
  Bearer key, JSON body `{inputs:{[INPUT_KEY]: schemaText}}`; reads `outputs.{OUTPUT_KEY}` (text) +
  `outputs.cost`. Server-only; per-call timeout + abort. Every call = a fresh VS run (own run_id), so
  concurrent user submissions are independent (no shared state). Form-data fallback documented inline.
- **Generator branch:** `lib/ai/analysisReport.ts` now switches on `AI_PROVIDER`:
  `vectorshift` (live) | `stub` (mock, default) | else in-code provider. Schema text is the model input.
- **Generate at submission, block until ready:** `app/api/runs/[id]/run/route.ts` — when `runPipeline`
  finalizes (`result.complete`), it generates the analysis for EVERY candidate site (Promise.all, per-site
  catch so one failure can't sink the submit), then returns. So the report is ready on the analysis page
  and never re-runs (cached in module_result). On-demand route stays as staff regenerate/fallback.
- **Cost (hidden) + usage monitor:** new `PipelineUsage` model + migration
  `20260826000002_pipeline_usage` — one append-only row per live VS run: userId, franchisorId,
  pipelineRunId, candidateSiteId, provider, model, vsRunId, cost_raw, cost_value, createdAt. **No response
  text stored here.** Cost is NEVER sent to the client (not in AnalysisReportResult). Response text lives in
  module_result (for display). Admin usage panel = later; the table captures cost from day one.
- **Env (.env.example):** AI_PROVIDER=vectorshift, VECTORSHIFT_API_KEY, VECTORSHIFT_PIPELINE_ID
  (=6a8e89b52ac88a5957edcb26), VECTORSHIFT_INPUT_KEY (BSA_v3_analsysis_page_intake),
  VECTORSHIFT_OUTPUT_KEY (Bsav3_Ai_analysis), VECTORSHIFT_TIMEOUT_MS. Default stays `stub` (safe).

**Verified:** provider + generator + both routes typecheck (shims, DOM+node libs); `prisma validate` OK.

**Operator (neon + Netlify):** `npx prisma migrate deploy` (applies analysis enum + pipeline_usage) →
set Netlify env `VECTORSHIFT_API_KEY`, `VECTORSHIFT_PIPELINE_ID`, and `AI_PROVIDER=vectorshift` → redeploy.
Until AI_PROVIDER=vectorshift, the mock pre-generates on submit (no cost). Pending: branded PDF export;
admin usage panel.

---

## 2026-08-25 (later 6) — Netlify build fixes (Confidence type + zonal schema restore)

Pushing later-4/5 to GitHub surfaced two build breaks (Netlify runs `prisma generate && next build`,
which typechecks the WHOLE project — dormant files included):

1. **Confidence type.** `lib/ai/analysisReport.ts` used `'high'|'medium'|'low'`; the real
   `@/lib/truth/truthLayer` `Confidence` is `'high'|'med'|'low'`. Fixed by importing the real
   `Confidence` type (analysisReport) and typing `AnalysisInput.meta.overallConfidence` as `string`
   (analysisContext, pure). Commit `8002874`.

2. **Zonal schema regression (my error).** The staged snapshot I edited was stale for the zonal files,
   so committing the `analysis`-enum schema reverted `ZonalValue`'s `barangay` grain (barangay field +
   `rdo` NOT NULL + widened `zonal_natural_key`), which `lib/ingest/loaders.ts` requires → build fail at
   loaders.ts:81. Restored `ZonalValue` on-device to match `df22215` exactly (verified by diff) + kept
   the `analysis` enum. `prisma validate` passes. Net schema diff vs df22215 is now only the enum.

Lesson: the `/mnt/user-data/uploads` snapshot can lag the device; for shared files, edit the device's
live file (or re-stage first) rather than committing a stale copy.

---

## 2026-08-25 (later 5) — Analysis tab = DETERMINISTIC combined report FIRST (AI deferred)

User pivot: do it one step at a time. Before any AI write-up, the 5th tab (now labelled just
**"Analysis"**, not "Analysis Report") must be a plain **Final Report that combines all data from the
four tabs** (Territory Guard, Lease Benchmark, Daypart Demand, White-Space) into one view.

**Implemented (no AI, no fetch, no DB write):** `components/SiteIntelligenceTabs.tsx` — `AnalysisTab`
rewritten to read the four persisted payloads it already receives via `payloads` and render a
read-through report: a header (`Combined site intelligence — {site}`, N of 4 modules present), then a
`ReportSection` per module with its verdict chip + key figures as `ReportRow`s, each tagged with its
Truth Layer (Verified/Assumed/Projected). Territory: verdict, own-branch overlap, competitive
saturation (direct+adjacent), est. cannibalization, competitor set, affected outlets. Lease: verdict,
corridor, comps, base-rent percentile, negotiating room, BIR zonal band (read loosely off payload).
Daypart: window-match band verdict, peak-hour captured, catchment mix, peak window, seasonality
peak/trough. White-Space: scanned, threshold, this-site cannibalization, top-3 recommended areas.
Missing/legacy modules show an honest "not run / re-run" note. Contextual (non-primary) modules are
flagged. Removed the AI Generate/Regenerate button + `/api/analysis-report` fetch from the tab, and
dropped the now-unused `runId` prop from `SiteIntelligenceTabs` + `site/page.tsx`.

**Verified:** TSX typechecks clean (React shims). Only `strict:true` in tsconfig — no unused-var gate.

**AI scaffolding is DORMANT, not deleted** (ready for the next step): `lib/ai/analysisPrompts.ts`,
`lib/ai/analysisReport.ts`, `lib/modules/analysisContext.ts`, `app/api/analysis-report/route.ts`, the
6 `analysis-*` chunks in `prisma/methodologyChunks.ts`, the `analysis` ModuleKind enum +
`migrations/20260826000001_add_analysis_module`, and the 3 docs in `3 - Skills/10 - AI Systems
Engineer/` all remain on disk. Nothing imports the route now, so it is inert. When we resume AI, the
combined report becomes the data foundation the write-up reads. No action needed for this step; the
enum migration is additive/harmless if already deployed.

---

## 2026-08-25 (later 4) — AI Analysis Report (5th site tab) — SUPERSEDED by (later 5) for now (scaffolding kept)

Built the AI "Analysis Report" — a 5th tab after Territory Guard / Lease Benchmark / Daypart /
White-Space. Retrieve-then-generate capstone: deterministic code assembles the four module results +
intake into strict JSON, the AI reads that JSON as its ONLY context and writes ≤2 paragraphs. No
figure is invented; every number is passed through with its Truth Layer. Runs on the stub provider
today; swap `AI_PROVIDER` for a live model and nothing else changes. Approved options: on-demand
generation, cached + regenerate; prompts in code + knowledge seeded to DB.

**Two prompts (in code, authoritative):** `lib/ai/analysisPrompts.ts` — `ANALYSIS_SYSTEM_PROMPT`
(identity + 6 hard rules: numbers only from JSON, preserve Truth Layer, broker-supplementation, no
price/legal/financial advice, only intake+module results, stay in scope) and
`ANALYSIS_TASK_INSTRUCTIONS` (≤2 paragraphs, 90–160 words; para 1 = composite verdict+score + the
driving modules with specific fields; para 2 = trade-offs, White-Space alternatives, confidence + the
one thing to verify on the ground). Human-readable mirrors + the in-depth knowledge doc live in
`3 - Skills/10 - AI Systems Engineer/` (files 1_/2_/3_).

**JSON assembler:** `lib/modules/analysisContext.ts` — pure, no AI, no server imports, unit-tested.
`buildAnalysisContext(input)` folds the four persisted payloads + intake + composite into the strict
JSON contract (each module a `{ran, isPrimary, truthLayer, …trimmed fields}` block), computes
`truthLayerSummary`, aggregates+dedups flags, stamps guardrails (brokerSupplementation, noPriceVerdict,
zonalIsTaxFloor). `analysisContextToJsonText` pretty-prints it — that text is the model's `context`.

**Generator:** `lib/ai/analysisReport.ts` — `generateAnalysisReport(runId, siteId, {force})`. Cache =
a persisted `module_result` (module='analysis'); `force` regenerates. Loads run+intake(A–F,H–J)+site+
the 4 module_results → builds AnalysisInput → `buildAnalysisContext` → `retrieve` interpretation
chunks → provider.generate({system: prompt#1, context: JSON+reference, task: prompt#2}) → logs to
`ai_generation` (purpose 'summary', reused to avoid a 2nd enum) → upserts the `analysis` module_result
(payload = {analysis, contextJson, model, confidence, generatedAt}).

**API:** `app/api/analysis-report/route.ts` — POST {runId, siteId, force?}, session + canAccessRun +
site-belongs-to-run guards, returns the report or the cache.

**Knowledge seeded:** `prisma/methodologyChunks.ts` — appended 6 `analysis-*` chunks (overview + how to
read Territory / Lease / Daypart / White-Space / composite+confidence). These ground the retrieve step
so the model interprets each field correctly. Re-seed to load them into `doc_chunk`.

**UI:** `components/SiteIntelligenceTabs.tsx` — added the `analysis` payload type, a 5th "Analysis
Report" tab, and `AnalysisTab`: Generate/Regenerate button (POSTs the route), renders the ≤2-para
report, a confidence chip + Verified/Assumed/Projected counts + generated-at/model, and a collapsible
"Show the data the AI read (strict JSON)". `app/(app)/site/page.tsx` loads `byModule.analysis` and
passes `runId`. `lib/modules/verticalConfig.ts` MODULE_LABELS gained `analysis: 'Analysis Report'`.

**Schema:** `ModuleKind` enum gained `analysis`
(`prisma/migrations/20260826000001_add_analysis_module/migration.sql`, additive + idempotent
`ADD VALUE IF NOT EXISTS`).

**Verified:** `analysisContext.ts` typechecks strict standalone; server files (generator+route) and the
TSX component typecheck with shims; 9/9 new unit tests pass (`tests/unit/analysisContext.test.ts` —
passthrough, truth-layer summary, missing-module gaps, rec cap, flag dedup, guardrails, JSON
round-trip, empty run).

**Operator runs (neon + docker):** `prisma generate` → `prisma migrate deploy` (applies the enum) →
re-seed knowledge (`npm run db:seed`, or the methodology-chunk seed) → open a site → Analysis Report
tab → Generate. Stub provider works out of the box; no key needed.

---

## 2026-08-25 (later 3) — BIR zonal values → Lease Benchmark integration — CODE COMPLETE (needs migrate + seed on neon)

Ingested the user's "NCR BIR Zonal Values" workbooks (19 files, 2 grains each) and wired zonal into
the Lease Benchmark. Approved options: barangay+city fallback grain; context+cross-check+fallback
role; ratio calibrated from our own comps.

**Data (Phase 0/1):** ETL over all workbooks → `prisma/data/zonal.real.json` REPLACED (26 → **2,317
rows**: 219 city-grain + 2,098 barangay-grain). Canonicalized 52 messy labels → 16 NCR cities;
parsed ₱ strings; kept explicit Verified/Assumed. CR/CC = 733 commercial rows. Anomalies: Valenzuela
folder held a duplicated Taguig file (city-grain survives via NCR Overview; barangay grain missing);
**San Juan absent entirely** → task #25 outstanding.

**Schema:** `ZonalValue` gained `barangay String @default("")` ('' = city grain) and `rdo` is now
`String @default("")`; natural key widened to (region, city, barangay, rdo, classificationCode),
mapped `zonal_value_natural_key`, + index `zonal_value_city_barangay_idx`. Migration
`prisma/migrations/20260826000000_zonal_barangay/migration.sql` — additive + idempotent (DO-block
drops the old unique index by shape, so it is safe on neon + docker). `lib/ingest/normalize.ts` +
`loaders.ts` updated (RawZonal.barangay + truth_layer; upsert includes barangay).

**Calibration (Phase 1b):** rent↔commercial-zonal ratio from the 13 corridors with BOTH comps and
zonal → median ≈ **₱10 per ₱1,000 of CR-zonal mid (~1%/mo)**; reliable band ₱6–14 (mid-tier), with
CBD (BGC/Makati ~3–5) and low-tier fringes (Marikina/Pateros ~25–37) as flagged outliers. Baked into
`leaseMath.ts` as ZONAL_RENT_PER_1000_CENTRAL/LOW/HIGH.

**Server (Phase 2):** `leaseMath.ts` added pure `canonicalNcrCity`, `bandMid`, `zonalRentCrossCheck`,
`indicativeRentFromZonal` + `ZonalBand` type. `leaseBenchmark.ts` added `resolveZonalBand(site)`
(barangay grain → city fallback; CR preferred, CC fallback; aggregates min-low/max-high across
Manila/QC district rows), attaches `zonal {band, crossCheck, indicativeRent, usedAsFallback}` to the
result, flags `zonal_fallback_anchor` / `rent_rich_vs_zonal`. GUARDRAIL respected: zonal never
overrides the comp verdict — Verified band + Projected cross-check/indicative, tax-floor framed.

**UI (Phase 3):** `SiteIntelligenceTabs` LeaseTab + standalone `LeaseBenchmarkView` both show a "BIR
commercial zonal value" card: Verified band, rent-to-land cross-check (goes live with the user's
typed asking rent), and a Projected indicative rent band. When comps are insufficient the verdict now
reads as a zonal-anchored indicative range instead of a dead end. API needed NO change (`...result`
spreads zonal through). New `tests/unit/zonalLease.test.ts` (10 cases) PASS; all lease UI + server +
math typecheck clean in cloud.

**⚠️ ACTION REQUIRED (local — DB is neon):**
1. `npx prisma generate` (client gets the `barangay` field).
2. `npx prisma migrate deploy` (applies 20260826000000_zonal_barangay to neon; DO-block is safe).
3. `npm run db:populate:ncr` (loads the 2,317 zonal rows via loadZonal; idempotent, ~1–2 min over neon).
4. `npm run typecheck && npm run test`; then re-run a lease analysis → the zonal card shows on the Lease tab.
5. Docker parity (optional): same 3 cmds with the `$env:DATABASE_URL=localhost:5433` override.
Outstanding data (task #25): re-export real **Valenzuela** (barangay) + **San Juan** (all) zonal.

---

## 2026-08-25 (later 2) — White-Space map dots (red/white) + all-industry POI ingest — COMPLETE (needs re-ingest + re-run on neon)

Two user asks on the working White-Space v2:
1. **Map: red dots = exact/direct rivals, white dots = similar/adjacent**, across ALL 5 areas so the visual matches the per-area data.
2. **Data coverage for ALL industries**, not just F&B.

Map dots:
- `lib/modules/p2p3Math.ts` — WhiteSpaceArea gains `nearbyPoints: {name,lat,lon,tier}[]` (tier 'direct'|'adjacent'); flows through the ranker via spread.
- `lib/modules/p2p3Modules.ts` — `scoreAt` now keeps each hit's lat/lon and emits `nearbyPoints` (cap 60/area, direct-first, deduped) alongside `nearbyBusinesses` (10 names for chips).
- `components/GapsMap.tsx` — new optional `businesses: BusinessPoint[]` prop; draws red (#e5484d, direct/exact) and white (#e6ebf5, adjacent/similar) dots UNDER the numbered area pins; native-title tooltips; dep array includes businesses.
- `components/SiteIntelligenceTabs.tsx` — flattens `recs.flatMap(r => r.nearbyPoints)` → `businesses`, passes to GapsMap, adds a map legend (red/white/# with counts). New rec field `nearbyPoints?` added to payload type.

All-industry POI ingest (data breadth):
- `lib/places/osmService.ts` — OSM_SELECTORS broadened: NEW `grocery` (supermarket/greengrocer/wholesale/marketplace), `hardware` (hardware/doityourself/paint/electrical), `electronics` (electronics/mobile_phone/computer/appliance); richer retail_apparel (+shoes/boutique), retail_specialty (+books/stationery/gift/toys/jewelry/cosmetics), remittance (+pawnbroker), diagnostics (+healthcare=clinic/centre), automotive (+car_parts/tyres), hotel (+guest_house/hostel), education (+college).
- `prisma/ingestOsm.ts` — SWEEP_VERTICALS was 14 (F&B-heavy, MISSING diagnostics/automotive/hotel and all grocery/hardware/electronics). Now 20, spanning F&B + full retail + convenience + pharmacy/diagnostics + services + fuel/automotive + hotel + education. BRAND_PULL expanded ~40→~70: added grocery/supermarket (SM Supermarket, Savemore, Puregold, Robinsons Supermarket, WalterMart, Landers, S&R, Rustan, Shopwise, Metro), apparel/retail (Uniqlo, Penshoppe, Bench, Oxygen, National Book Store, Ace Hardware, Wilcon, Handyman, Abenson, Automatic Centre), health (Generika, Hi-Precision, Healthway), more F&B (Max's, Yellow Cab, Shakey's, Pizza Hut, Army Navy, Potato Corner, Bo's Coffee, Tim Hortons, Dunkin, Mister Donut, Krispy Kreme, J.CO), services/fitness (Nuat Thai, Ace Water Spa, Fitness First, Slimmers World), fuel/auto (Seaoil, Phoenix, Rapide, Ziebart), remittance/courier (J&T), hotels/education (Go Hotels, Red Planet, RedDoorz, Kumon).

Note on coverage: OSM_SELECTORS + conceptFor already cover every intake Vertical. Gaps were (a) sweep list omissions and (b) no grocery/supermarket data at all — both fixed. NOT added this round: a dedicated grocery/supermarket INTAKE vertical + conceptFor mapping (would need a Prisma enum change + migration on neon) — flagged as a future option; the competitor_set C11 grocery rows already exist for naming.

Verified in cloud: UI + server tsc clean, GapsMap compiles (maplibre shim), ingest files parse, 14 vitest tests pass (whitespace.test.ts factory updated with nearbyPoints).

**⚠️ ACTION REQUIRED (local, writes to NEON — DB target is neon.tech, not local Docker):**
1. `npm run db:ingest:osm` — re-ingest POIs across all industries from OSM/Overpass (free, no key; ~20 category sweeps + ~70 brand pulls; takes a while, politeness delays). Populates non-F&B businesses.
2. `npm run db:populate:ncr` if not already done (demographic_cell / barangays) — fixes any lingering "scanned 0".
3. Re-run the analysis → White-Space map now shows red/white business dots across all 5 areas.
4. `npm run typecheck` && `npm run test` to confirm.

---

## 2026-08-25 (later) — White-Space v2: always top-5 BETTER alternatives vs the proposed site — COMPLETE

Symptom: White-Space showed "scanned 0 barangays / no low-cannibalization areas." Root cause =
`demographic_cell` is effectively empty on this machine (the dump didn't include it), so the scan
had no candidate grid. Plus a design gap: the hard ≤40 gate dead-ended instead of showing the best
available alternatives. User clarified the intent: **based on the proposed site, find the top 5
OTHER (better) areas the user did not input.**

Changes (all committed):
- `lib/modules/p2p3Math.ts` — `rankWhiteSpaceRecommendations` no longer hard-filters by threshold;
  it ALWAYS returns the top `limit` by blended score (60% low-cannibalization + 40% demand),
  best-first. `WHITESPACE_CANNIBALIZATION_MAX`=40 is now a verdict LABEL only. Added
  `beatsProposed` (vs the proposed site's cannibalization) and `proposedCannibalizationPct` opt;
  `whiteSpaceVerdict(pct, threshold?)` takes an optional threshold. Dedupe keeps the
  lowest-cannibalization instance. Handles population=0 (POI fallback) → ranks on cannibalization.
- `lib/modules/p2p3Modules.ts` — `runWhiteSpace` rewritten: fetches the proposed site and scores it;
  computes nearest-own distance in code from an outlets pull (works for any area source); scans
  `demographic_cell` first, and FALLS BACK to POI-derived areas (poi grouped by barangay/city,
  centroid = AVG, HAVING COUNT>=3) when the demographic layer is empty so it never scans zero;
  EXCLUDES the proposed area (within 0.75×catchment of the site); ranks top 5 vs the proposed
  cannibalization. Payload adds `proposed {label,city,cannibalizationPct,mix,nearbyBusinesses}` and
  `source: 'demographic_cell'|'poi_fallback'`; flags `poi_derived_areas` / `no_area_data`.
- `components/SiteIntelligenceTabs.tsx` — WhiteSpaceTab reframed: header "Top N areas to open
  instead of your proposed site" with the proposed site's own cannibalization; per-card "X% lower
  than your site" delta chip (from beatsProposed) + verdict badge; population shows "—" on fallback;
  amber note when `source==='poi_fallback'` telling the user to run `db:populate:ncr`; empty state
  only when there are truly zero candidate areas.
- `tests/unit/whitespace.test.ts` — updated for always-top-5 + beatsProposed + population-0 ranking.
  14 tests PASS (ran real vitest in cloud). Both the UI and server modules typecheck clean in cloud.

**⚠️ ACTION REQUIRED (local): the real fix for "scanned 0" is to load demographic data.**
1. Ensure Docker DB up (`docker compose up -d`), then `npm run db:populate:ncr` (loads NCR
   barangays into demographic_cell). Optionally `npm run db:seed-all` for the full reference set.
2. Re-run the analysis. With demographics loaded you get population-weighted, barangay-level
   recommendations; without them the POI fallback now still yields city/area-level results.
3. `npm run typecheck` and `npm run test` should both pass.

---

## 2026-08-25 — White-Space rebuilt as "recommended locations" (reverse Territory Guard) — COMPLETE (needs local re-seed + re-run to populate)

Reworked the White-Space module per user request: it no longer ranks "unserved gaps" (which
returned nothing for established networks and was gated as a contextual read). It now answers a
question that applies to EVERY operator and EVERY industry: **the top 5 areas to open, with a
cannibalization score of 40 or less** — same scoring engine as Territory Guard, applied across
areas instead of one site.

**What changed**
- `lib/modules/p2p3Math.ts` — added pure `WhiteSpaceArea`/`WhiteSpaceRecommendation` types +
  `rankWhiteSpaceRecommendations()` (filter cannibalization ≤ `WHITESPACE_CANNIBALIZATION_MAX`=40,
  score 60% low-cannibalization + 40% demand, dedupe by barangay, top 5) + `whiteSpaceVerdict()`
  (open <15 / workable 15–<40 / contested ≥40, aligned to `verdictFromOverlap`). Old
  `rankWhiteSpace` left in place (now unused) to avoid breaking anything.
- `lib/modules/p2p3Modules.ts` — rewrote `runWhiteSpace(runId, siteId, franchisorId, vertical?,
  brandOrConcept?, ownBrandName?)`: scans every `demographic_cell` barangay; for each, tiers nearby
  `poi` (category='competitor') by concept with the SAME `conceptFor`/`tierFor`/`weightedCompetitorCount`
  path Territory Guard uses → competitive saturation (`competitiveSaturationPct`); combines with an
  own-branch overlap proxy (from nearest own-outlet distance) → per-area cannibalization; returns
  top 5 ≤40 with competitor mix, the actual nearby business names, and a named competitor set.
  Two SQL reads (barangays + all competitor POIs), tiering in code.
- `lib/modules/territoryGuard.ts` — exported `lookupCompetitorSet` (was private) so White-Space
  names the same rivals.
- `lib/modules/orchestrator.ts` — `runWhiteSpace` call now passes vertical + conceptText + brandName.
- `lib/modules/verticalConfig.ts` — White-Space is now PRIMARY for every vertical (removed the
  `whitespace: ['convenience','remittance']` gate) → no more "Contextual read" banner on it.
- `components/SiteIntelligenceTabs.tsx` — rebuilt `WhiteSpaceTab`: removed the "underserved
  areas / your network already covers this territory" section; now renders a header, a map of the
  top-5 recommended areas, the named competitor set, and per-area cards (verdict chip +
  cannibalization %, direct/adjacent mix, population, nearest own branch, and the real "Businesses
  in the area" chips). New payload shape `{ recommendations, scanned, threshold, concept,
  competitorSet }`; a legacy `gaps` payload now shows the Re-run prompt.
- `prisma/data/competitorSets.real.json` — added 10 rows so every industry resolves a named set:
  spa (Nuat Thai, Ace Water Spa), apparel (Bench, Penshoppe), diagnostics (Hi-Precision), fuel
  (Petron, Shell), automotive (Rapide), hotel (Go Hotels, Red Planet). 79 → 89 rows.
- `tests/unit/whitespace.test.ts` — NEW: 10 vitest cases for the ranker (threshold filter, ranking,
  dedupe, limit, verdict bands, reason text). Algorithm verified in cloud (13 assertions pass);
  the pure module transpiles clean.

**Data check (user asked to ensure all industries are covered):** no new data dependency — the
per-area scan reuses exactly Territory Guard's path (POI tiering + `conceptFor`, which maps ALL
verticals, + demographic_cell). Named competitor sets now cover every concept key.

**⚠️ ACTION REQUIRED (local, user runs — cloud can't reach the Docker DB):**
1. `npm run db:seed-cannibalization` — load the 10 new competitor_set rows.
2. Re-run any analysis (New Intake → same inputs → Submit & run, or the run's re-run button) so
   existing runs get the new whitespace payload. Runs made before this show the Re-run prompt on
   the White-Space tab until then.
3. `npm run test` (or vitest) — the new whitespace test should pass alongside the suite.

Note: White-Space is site-agnostic (depends on brand/concept + network, not the specific
candidate), so it recomputes per site in a multi-site run — fine for typical 1–3 site runs; a
future optimization could compute once per run.

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
