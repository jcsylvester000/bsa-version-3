# BSA — Project Memory (current state)

**Read this first in every new thread**, after the Master Instruction. It is the short,
always-current snapshot. `WORKLOG.md` is the full history (newest first). This file is
rewritten at the end of every work batch — if it disagrees with older notes (e.g.
`2 - Data Intake/Migration Guide/PROJECT_MEMORY_EXPORT.md`, 2026-08-10), **this file wins**.

_Last updated: 2026-10-08 (end of day, paused) — capture playbook enforced (in the folder, **not yet pushed**); Capture Coverage pushed `55ff1f0`; Design v2 batches 0–13 pushed (HEAD `498db86`, hotfix `db36c53`)._

## ⏸ Paused 2026-10-08 — resume here

**State:** git HEAD `55ff1f0` (Capture Coverage + retry queue). Working tree holds the uncommitted, tested
"capture playbook enforced" batch (tsc clean · vitest 559/559 · next build OK). Nothing else is in flight.

**Owner to-do before/at next session**
1. Push the playbook batch: `git add -A` → `git commit -m "Capture playbook enforced: pre-flight checklist, ring limits, 3 types max, one area at a time, OSM status, what-to-capture-next"` → `git push` (no migration).
2. Confirm Netlify applied migration `20261008000000_capture_gaps` (Capture Coverage loads without a `db_migration_pending` reason).
3. If not done yet: `npm run db:recompute-composites` once (Territory Guard deal-breaker for runs saved before 2026-10-07).
4. Security: the seeded admin `admin@grid.test` uses the public demo password `bsa-demo-1234` — change it
   (Settings → Change password) or create a real admin and retire the demo one (runbook F-31).
5. Load barangay boundaries for every region being captured (`db:fetch-boundaries -- --region=<r>` → `db:load-boundaries` → `db:tag-boundaries`); Capture Coverage lists regions missing them.

**Suggested next work (not started)**
- Owner smoke test of the enforced playbook on the live site (dense pin, no-boundary pin, failed layer → retry list → retry → save closes it).
- Optional hardening for the dev team: self-hosted/paid Overpass instance; overnight job that works the retry queue.
- Read-only capture coverage view for analysts; Laguna/Pampanga lease corridors when comps exist.

**Dev notes for the next thread**
- Neon HTTP adapter refuses transactions: no `createMany`, nested writes or `$transaction` on request paths — plain statements only.
- Local real-DB checks used a Neon `/sql` emulator over PG16+PostGIS (real `@neondatabase/serverless` + `PrismaNeonHTTP`); not shipped — rebuild if needed.
- Capture rules live in `lib/capture/capturePolicy.ts` (shared by screen and API); playbook text in `docs/PLACE_CAPTURE_PLAYBOOK.md` (also saved to the claude.ai project).

**Latest batch (2026-10-08 b, ⏳ awaiting push):** the capture playbook is enforced, not advisory —
`lib/capture/capturePolicy.ts` (ring ≤ 1,000 m dense / 1,500 m, ≤ 3 types, off-peak 05–12 PHT, 90-day freshness),
`POST /plan` pre-flight + `GET /osm-status`, "Before you capture" checklist gating the button, one area at a time,
no-boundary acknowledgement, "What to capture next" on Capture Coverage. No migration.
**Batch before (2026-10-08, pushed `55ff1f0`):** Admin → **Capture Coverage** (`/admin/coverage`): map of saved capture
areas by freshness (90 d), Territory Guard coverage cells per layer, capture log (where/when/who/layers/new places),
by-region table, playbook; **retry queue** `poi_capture_gap` (migration `20261008000000_capture_gaps`, also
`poi_capture_batch.fetched_layers`) — `/preview` logs failed / place-limit layers, `/save` auto-resolves covered
entries, `?retry=<id>` deep link re-runs one; workbench auto-retries a busy layer twice (4 s, 10 s), marks
place-limit layers incomplete (never stamped covered), shows "captured here before". Playbook:
`docs/PLACE_CAPTURE_PLAYBOOK.md`.
**Batch before (2026-10-07 late):** (1) **Save fixed on Neon** — `createMany` ran inside an implicit
Prisma transaction, which the Neon HTTP adapter refuses → 500 `[reason: unexpected]`; now a plain multi-row INSERT
(verified through an emulated Neon HTTP endpoint). Rule: no `createMany`/nested writes/`$transaction` on Neon paths.
(2) **Capture v3**: all 18 PH regions in the jump list, tick up to 6 business types, one `/preview` per layer
(cached 30 min, two Overpass endpoints, 90-day coverage skip), only NEW places listed/saved (`ON CONFLICT DO NOTHING`),
multi-area results table + save status screen. (3) **Scoring**: Territory Guard overlap ≥ 40 % caps composite at 44 and
forces No-Go (15–40 % caps at 64) — `scorecard.territoryGate`, `siteVerdict.territoryVeto`; run
`npm run db:recompute-composites` once for existing runs.
**Previous batch (2026-10-07):** Admin → Place Capture (`/admin/capture`, admins only), v2 workflow:
pin a site (Territory Guard catchment rings + live "what Territory Guard sees") → **load places onto the map
(read-only `/preview`, `/import`)** → review in the browser → **`/save` is the only write** (poi + PSGC + coverage
stamps + audit; OSM receipts decide Verified vs Assumed). New regions **laguna** + **pampanga**. OSM key
`(osm_type, osm_id)`. Migration `20261007000000_admin_poi_capture` must be deployed (errors now say
`[reason: db_migration_pending]`). Notes: `docs/ADMIN_POI_CAPTURE_PLAN.md` §11 + WORKLOG.
**Key decisions:** only admins save; nothing is written before Save; grid-navigator stays a separate offline tool (BSA imports its files);
imported/manual places are Assumed and imports never overwrite stored places; ONE category rule
(`lib/places/osmCategory.ts`) for every POI write path — business tags stay `competitor`.
**Next:** owner deploys + smoke-tests; load Laguna/Pampanga boundaries + OSM sweeps; lease corridors for
Laguna/Pampanga when comps exist; optional: show capture coverage to analysts read-only.

---

## Where the build stands

- Stack (fixed): Next.js 14 App Router · React 18 · TS strict · Prisma 5 · Postgres on neon.tech
  (PostGIS + pgvector) · Netlify (`@netlify/plugin-nextjs`). Repo: `github.com/jcsylvester000/bsa-version-3`
  (**should be private**). Local `.env` targets Neon with `AUTH_MODE=db`, `AI_PROVIDER=vectorshift`.
- Journey: login → Franchise Screening → 4-step intake (≤5 sites) → run dashboard → per-site page with
  5 tabs (Territory Guard · Lease Benchmark [+ save asking rent] · Daypart · White-Space · Analysis
  [AI write-up + Export site PDF]). Dashboard also links the Run Report (all sites) and Scorecard.
  Standalone /territory-guard, /lease-benchmark, /daypart, /whitespace pages were RETIRED (Batch 5).
- Handoff package: `README.md`, `docs/HANDOFF.md`, `docs/API_REFERENCE.md`, `docs/DATA_DICTIONARY.md`,
  `docs/SECURITY_POSTURE.md`.
- Pipeline: `lib/modules/orchestrator.ts` — time-boxed 5.5s slices, client re-invokes until `complete`.
  Per-site modules isolated; site done = `candidate_site.analyzed_at`. AI write-up is a SEPARATE
  per-site request (`POST /api/analysis-report`), locked against double-billing.
- Tests: 531/531 (vitest, 2026-10-07). Typecheck 0 errors. `next build` passes.

## Design v2 (2026-09-25) — Claude Design bundle implemented
Source: `2 -  Data Intake/BSA Design System Overview/implementation/` (README + PATCHES + mockups).
Tracker: **`docs/DESIGN_V2_CHECKLIST.md`** (item checklist + push log — update the log on every push).
- Tokens are CSS variables (`app/globals.css`, `[data-theme]`); Tailwind colours resolve through them.
  `<html data-theme="dark">` is the default. Light tokens + dual `GridLogo` exist; **no Settings toggle
  yet (owner chose dark only)**.
- Shared UI vocabulary: `components/ui/Chips.tsx` (TruthChip glyph+word/`compact`, TruthLegend,
  VerdictPill icon+word, StatusText), `ui/Panel.tsx` (TruthMixBar), `ui/StatTile.tsx` (`truth`, honest gap),
  `components/FinalReport.tsx` (hero + findings), `components/MapMarkers.tsx` (`.mk-*` markers, legend,
  sr-only list). Status is never colour alone.
- Site page opens on the **Final Report** tab (`?tab=` validated); Export PDF + Re-run in the page header.
  Hero shows the composite, rank n of N, run confidence, analysed time (Manila, ICU-free), truth mix.
  The hero never contradicts the dashboard: when the site has a composite band it shows that call.
- Rent is never coloured good/bad (lease tones muted, neutral asking bar, "Distance from corridor median").
- Batches 0–4 pushed (`0ecddcd` … `f82716d`). Batches 5–8 (all-runs table + run states, Franchise Screening
  cards + "Start intake with this brand", site-tab content + zonal card + findings figures, Settings + error/
  loading states) pushed: `1fc780c`, `89deb3c`, `12ab500`, `df39955` (HEAD = origin/main, tree clean).
- Batch 9 (2026-09-28): Scorecard / All Modules / Explore Places confirmed already removed; `/reports` (Run
  report, all sites) rebuilt in the v2 layout; rent metrics neutral; lockfile re-synced — pushed `f60b7ea`.
- Batch 13 (2026-09-28, pushed `498db86`): **Export site PDF = the Final Report screen as data.** One pure model
  `lib/modules/siteReportModel.ts` feeds both the tab and `lib/pdf/AnalysisPdf.tsx` — change the report in the
  model, never in only one renderer. PDF fonts embedded (`lib/pdf/pdfFonts.ts`).
- Batches 10–12 pushed (`300bb29`, `e4f7da9`, `9fc30b8`): printable full report in v2 + CSP-safe print button; lease finding
  = neutral statement (broker decision); Appearance switch Dark / Light / Match device (`bsa-theme` cookie).
- **Key decisions (don't undo without the owner):** lease/rent is never a Proceed/Caution vote or a green/red
  colour anywhere in the UI or reports — it counts only through the composite's lease value score. Theme
  default is dark; the cookie is validated by `parseTheme`.
- Open design items: PRC licence field (schema decision).

## Code-review fix programme (started 2026-09-23)

| Batch | Scope | Status |
|---|---|---|
| 1 | Security: admin role gates, fail-closed AUTH_SECRET, demo logins off when deployed, login/register rate limits, 10-char passwords, security headers/CSP, brand privacy (`franchisor.created_by_user_id`), dump removed from git | ✅ pushed (`eb23b13`) |
| 2 | AI runtime: no AI inside the run route, one site per request, per-site lock, regenerate (3/site/day), read-only PDF + status GET, safe errors, strict `AI_PROVIDER`, usage log status/latency | ✅ pushed (`c5ccfaf`) |
| 3 | Scoring/pipeline: evidence confidence (not always Low), lease value score + recompute on asking rent, per-module isolation, `analyzed_at` resume, `failed` status, stale-score clearing, outlet ownership per intake, Re-run analysis (refresh) | ✅ pushed (`c5ccfaf`) |
| 4 | Truth Layer + guardrails: honest demographic/lease/territory labels, no fake zeros, proxy-corridor flag, positional lease labels (no price verdicts), RA 9646 disclaimers, zonal-floor wording, AI output check, reference sent to VectorShift; mall ≤3 km, daypart all-day range, canonical zoning city, concept-aware informal | ✅ pushed (`fb4e312`) |
| 5 | Hygiene + hotfix: hydration #418 (Manila-time formatter), non-fatal usage log + reason codes for AI 502s, maptiles 200-when-off; reports on demand (no storage) + both kept & relabelled; report PII via POST; retired 4 pages + 5 components + root scripts; Lease tab saves asking rent; rankWhiteSpace v1 removed; README + HANDOFF + security/API docs | ✅ pushed (`321b49f`) |

**Audit workbook progress (docs/BSA_Application_Audit.xlsx):** 47 Done as of 2026-09-25 (of ~52). Everything code-completable is done: F-13 lease loader, F-25 Google quotas+bounds, F-43 tests+Playwright CI smoke, F-46 lint, F-51 monitoring seam (lib/monitoring/report.ts + /api/client-error), F-52 docs. F-44 (full per-tab split) In progress — needs visual QA. The 4 Open (F-16 isochrones, F-17 NCR zonal gaps, F-19 provincial loads, F-31 credential rotation) are OWNER actions, documented step-by-step in docs/OWNER_RUNBOOK.md. Code-health: F-47 service layer done (lib/services/{runs,sites,reports,account}.ts; NO app page imports prisma directly). F-43/F-44/F-46 partially done (safe subset) — remaining parts need infra (integration DB, Playwright, full component split, ESLint config); documented in WORKLOG. F-12 & F-42 status corrected to Done. Security F-26 (session revocation via app_user.sessions_valid_after, migration 20260927000002; getSession reads DB per request via React cache, refreshes role/franchisor, rejects revoked tokens; logout+password-change bump the cut-off) + F-30 (middleware.ts: edge auth guard + per-request CSP nonce, static CSP removed from next.config). F-25 still open. UX/accessibility set done: F-36 aria-labels on intake inputs/icon buttons, F-37 responsive intake rows + scrollable lease table, F-39 12px text floor everywhere, F-40 lease corridor picker (re-benchmark from a proxy) + map verdict already single-sourced, F-41 redesign delivered by DESIGN v2. F-22 batched loaders (POI/demographics chunked ON CONFLICT via prisma/scriptDb.ts direct pooled client) + F-23 /api/brands single-scan + 5-min cache. F-15 accessibility pillar (transport layer via db:ingest:osm:transport; scores stay null until loaded) + F-18 (POI provenance: google source + poi.provenance, migration 20260927000001; real PSA ages via age_profile.real.json else modelled proxy; db:rerun-historical to refresh old runs). Security F-24/27/28/29; White-Space scoped to 15 km (F-11/F-20); pipeline integrity F-05 (per-site claim via candidate_site.claimed_at, migration 20260927000000_site_claim) + F-06 (intake gates-before-writes + compensating rollback, no orphan brands). Rate limiting fails closed, and on a hosted deployment only the platform's client-IP header is trusted. Login demo hints are gated by `isMockAuth()` via the server wrapper.

## Pending owner actions (carry forward until confirmed)

1. `npx prisma generate` then `npx prisma migrate deploy` — applies 4 new migrations:
   `20260923000000_franchisor_creator`, `20260923000001_pipeline_usage_status`,
   `20260923000002_pipeline_integrity`, `20260923000003_truth_layer_fixes` (idempotent).
   Then `npm run db:seed-methodology` (reloads the edited methodology text; safe on Neon —
   never `db:seed` on a shared DB).
2. Netlify: `AUTH_SECRET` (32+ chars) must be set — deploys without it now refuse sign-in.
   Check function timeout ≥ 26s, else lower `VECTORSHIFT_TIMEOUT_MS` below it.
3. Browser smoke test after deploy: maps + fonts load (CSP); submit an intake; Analysis tab shows
   the write-up; dashboard "↻ Re-run analysis" works. If CSP blocks something: `BSA_CSP_REPORT_ONLY=1`.
4. GitHub repo → Private (if not done). Rotate passwords of real accounts that were in the old dump.
5. Existing runs keep their old scores/labels/write-ups until re-run (dashboard "↻ Re-run analysis").
6. Optional: add to the VectorShift prompt — "An INTERPRETATION REFERENCE may follow the schema; use it
   only to understand the fields; cite figures only from the schema." (`VECTORSHIFT_SEND_REFERENCE=0` reverts.)
7. If the Analysis tab still errors after migrate + deploy, read the `[reason: …]` in the red box
   (`db_migration_pending`, `timeout`, `function_timeout`, `http_401`…) — that's the diagnosis.
8. Optional clean-up: delete the git-ignored `_to_delete/` folder (old archives + retired files).

## Key decisions (don't undo without the user)

- **Confidence** = decision-weighted evidence (Verified 1 · Assumed 0.7 · Projected 0.35 · missing 0;
  High ≥ 0.75, Medium ≥ 0.5; −1 band for on-ground flags/failed modules). Typical good run = Medium;
  missing demand data = Low. Implemented in `lib/modules/scorecard.ts`.
- **Lease** counts in the composite only once the user enters an asking rent; stored score is a VALUE
  score (100 − rent percentile).
- **Outlets**: NULL `intake_submission_id` = brand reference network (shared); typed outlets belong to
  their intake and only that run sees them.
- **Brands**: `created_by_user_id` NULL = shared catalog; set = private to creator + staff.
- **AI analysis REMOVED (2026-09-25):** the VectorShift Analysis Report is gone (not the core product,
  and the source of the neon-http transaction 502 / timeouts). The Analysis tab's **Final Report** is now
  a DETERMINISTIC recommendation — `lib/modules/siteVerdict.ts` `summariseSite()` rolls the module results
  into **Proceed / Proceed with caution / No-Go** with a headline, findings (keyword: data) and keywords;
  the site PDF renders the same. No Generate button, no polling, no external call. Deleted:
  `lib/ai/analysisReport.ts`, `vectorshiftProvider.ts`, `enqueue.ts`, `app/api/analysis-report/route.ts`,
  `netlify/functions/*`. KEPT: the short module verdict-line phrasing (`generateGrounded` → deterministic
  StubProvider) used by territory-guard / lease-benchmark. `VECTORSHIFT_*` / `ANALYSIS_BACKGROUND` /
  `INTERNAL_JOB_SECRET` env vars are now unused.
- **Left nav trimmed (2026-09-25):** Explore Places, All Modules, Scorecard removed; only Franchise
  Screening · Site Dashboard · New Intake remain (`SidebarNav.tsx`).
- Demo logins never work on deployments unless `BSA_ALLOW_DEMO_LOGINS=1` (admin/analyst never).
- **Guardrail wording** lives ONLY in `lib/truth/guardrailCopy.ts` (lease position labels, zonal floor note,
  RA 9646 disclaimers, price-verdict patterns). Lease is described by position vs the corridor, never
  judged. The AI output check (`lib/ai/outputCheck.ts`) warns, it does not block.
- **Truth labels come from the data rows** (demographics, comps, outlets), never hard-coded; missing values
  show "—", never 0.

## Workflow conventions

- **Backlog approved (all 36):** `docs/BSA_Improvement_Backlog.xlsx`. Building in dependency order, P1 first.
  Progress: **R-01 done** (region registry `lib/geo/regions.ts`; migration `20260923000004_region_columns`).
  **R-02 done** (code): `admin_boundary` polygons + psgc columns; `prisma/loadBoundaries.ts` +
  `prisma/tagByBoundary.ts`; runtime `lib/geo/adminBoundary.ts`; migration `20260923000005_admin_boundary`.
  R-02 easy data load: `npm run db:fetch-boundaries -- --region=cavite|batangas` (auto-download, no GDAL) →
  `db:tag-boundaries`. **R-03 done** (code): adaptive tiled Overpass sweep `lib/geo/tiling.ts` +
  `osmService.establishmentsInTiles`; `ingestOsm` tiles by default with a `poi_coverage` (source='bulk')
  resume checkpoint (no migration). **R-04 done** (code): `demographic_cell.geom` widened to MultiPolygon
  (migration `20260923000006`), `prisma/loadDemographics.ts` loads a barangay-population CSV (file or --url,
  population Verified) tied to admin_boundary; `lib/util/csv.ts` + `lib/geo/demographicsRow.ts` (tolerant,
  tested). R-04 needs a CSV download (HDX COD-PS admin4 / PSA — see `prisma/data/demographics/README.md`).
  **R-05 done** (code): zonal lookup (lease + land zoning) now region-aware (`canonicalCity` + PSA region,
  NCR unchanged); `prisma/loadZonalCsv.ts` + `lib/geo/zonalRow.ts` load a BIR zonal CSV (RDO 54A/54B/58/59;
  see `prisma/data/zonal/README.md`). Also hardened R-03: tiled sweep splits+retries on Overpass 504/timeout,
  resumable.
  **R-06 done** (code): Cavite/Batangas lease corridors added to the registry (Cavite: Bacoor–Imus,
  Dasmariñas–General Trias, Tagaytay–Silang; Batangas: Sto. Tomas–Tanauan, Lipa, Batangas City);
  `inferCorridor` is now region-first (Cavite/Batangas sites hit their own corridor, NCR/Davao unchanged);
  `prisma/loadLeaseCsv.ts` + `lib/geo/leaseRow.ts` load a broker/published lease-comp CSV (see
  `prisma/data/lease/README.md`), dropping any comp with no numeric term (no fabrication). No migration.
  **R-07 done** (code): `db:load-malls` (region-aware CSV → `mall_property`, tolerant tier/footfall,
  region stamped, geom from lat/lon; Mall Match is nearest-by-geom so provincial malls just work) and
  `db:load-traffic` (JSON → `traffic_corridor`, corridor names match R-06 so daypart resolves them).
  Ships Projected seasonal templates `prisma/data/traffic/{cavite,batangas}.template.json` (aadtRef null,
  owner fills from DPWH ATTAS); province seasonal direction differs from NCR (Undas=inflow spike, Holy
  Week=tourism peak/commuter dip). No migration. Mappers `lib/geo/{mallRow,trafficRow}.ts`, tests added.
  **R-08 done** — **R-series COMPLETE**. Regression guard `tests/unit/regionalQa.test.ts` (12 cases)
  asserts Cavite/Batangas sites resolve entirely in-region (corridor + zonal IV-A, never NCR) and NCR is
  unchanged; pins the corridor↔traffic-template contract. Handoff doc
  `docs/qa-history/QA_JOURNEY_FINDINGS_CALABARZON.md` (wiring PASS vs owner-loaded data, per-module
  before/after-load table, one-province load order). 412/412 tests.
  **Next: the non-regional backlog** (all approved in `docs/BSA_Improvement_Backlog.xlsx`): Data/scoring
  D-01.., AI I-01.., Architecture A-01.., Operations O-01.., Security S-01.., UX U-01... Provincial data
  itself is owner-loaded via the R-02/03/04/05/06/07 loaders (each with a README).
  Region model: `lib/geo/regions.ts` is the single source of truth (bbox, Overpass areas, warm centres,
  corridors, LGU canonicalisers); `inferCorridor`/`canonicalNcrCity` are registry-backed (behaviour
  unchanged for NCR/Davao). A site's region = LGU name first, else pinned coordinate.
- Next (not started): see `docs/HANDOFF.md` §4 — pgvector hybrid retrieval, White-Space SQL-side tiering,
  API-first page data, nonce CSP, session revocation, S3/R2 only if uploads return. Skill 12
  (`3 - Skills/12 - Orchestration and Delivery Lead/SKILL.md`) now exists and encodes this workflow
  (state reconstruction, batches, verification recipe, logging, PowerShell command blocks).
- After each batch: update `WORKLOG.md` (entry at top) + rewrite this file + ALWAYS give the user the
  GitHub update commands (`git add -A` / `git commit -m "…"` / `git push origin main`) plus any DB commands,
  PowerShell-safe (one command per line — PowerShell 5 has no `&&`).
- Verify in the cloud sandbox: copy to `/tmp/bsa`, `npm ci`, `prisma generate` with dummy engine env
  vars (`PRISMA_SCHEMA_ENGINE_BINARY` / `PRISMA_QUERY_ENGINE_LIBRARY`), then `tsc --noEmit` + `vitest run`.
- Never edit `2 - Data Intake`; code only in `4 - Final Application`.
