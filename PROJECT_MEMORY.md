# BSA — Project Memory (current state)

**Read this first in every new thread**, after the Master Instruction. It is the short,
always-current snapshot. `WORKLOG.md` is the full history (newest first). This file is
rewritten at the end of every work batch — if it disagrees with older notes (e.g.
`2 - Data Intake/Migration Guide/PROJECT_MEMORY_EXPORT.md`, 2026-08-10), **this file wins**.

_Last updated: 2026-09-25 — after Design v2 implementation (Claude Design bundle, 4 batches, pending push)._

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
- Tests: 331/331 (vitest). Typecheck 0 errors. `next build` passes.

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
- Batches 0–4 are code-complete and verified (tsc 0 · vitest 426/426 · next build OK) — **pending push**.

## Code-review fix programme (started 2026-09-23)

| Batch | Scope | Status |
|---|---|---|
| 1 | Security: admin role gates, fail-closed AUTH_SECRET, demo logins off when deployed, login/register rate limits, 10-char passwords, security headers/CSP, brand privacy (`franchisor.created_by_user_id`), dump removed from git | ✅ pushed (`eb23b13`) |
| 2 | AI runtime: no AI inside the run route, one site per request, per-site lock, regenerate (3/site/day), read-only PDF + status GET, safe errors, strict `AI_PROVIDER`, usage log status/latency | ✅ pushed (`c5ccfaf`) |
| 3 | Scoring/pipeline: evidence confidence (not always Low), lease value score + recompute on asking rent, per-module isolation, `analyzed_at` resume, `failed` status, stale-score clearing, outlet ownership per intake, Re-run analysis (refresh) | ✅ pushed (`c5ccfaf`) |
| 4 | Truth Layer + guardrails: honest demographic/lease/territory labels, no fake zeros, proxy-corridor flag, positional lease labels (no price verdicts), RA 9646 disclaimers, zonal-floor wording, AI output check, reference sent to VectorShift; mall ≤3 km, daypart all-day range, canonical zoning city, concept-aware informal | ✅ pushed (`fb4e312`) |
| 5 | Hygiene + hotfix: hydration #418 (Manila-time formatter), non-fatal usage log + reason codes for AI 502s, maptiles 200-when-off; reports on demand (no storage) + both kept & relabelled; report PII via POST; retired 4 pages + 5 components + root scripts; Lease tab saves asking rent; rankWhiteSpace v1 removed; README + HANDOFF + security/API docs | ✅ pushed (`321b49f`) |

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
