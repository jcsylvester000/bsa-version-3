# BSA — Project Memory (current state)

**Read this first in every new thread**, after the Master Instruction. It is the short,
always-current snapshot. `WORKLOG.md` is the full history (newest first). This file is
rewritten at the end of every work batch — if it disagrees with older notes (e.g.
`2 - Data Intake/Migration Guide/PROJECT_MEMORY_EXPORT.md`, 2026-08-10), **this file wins**.

_Last updated: 2026-09-23 — after Fix Batch 3._

---

## Where the build stands

- Stack (fixed): Next.js 14 App Router · React 18 · TS strict · Prisma 5 · Postgres on neon.tech
  (PostGIS + pgvector) · Netlify (`@netlify/plugin-nextjs`). Repo: `github.com/jcsylvester000/bsa-version-3`
  (**should be private**). Local `.env` targets Neon with `AUTH_MODE=db`, `AI_PROVIDER=vectorshift`.
- Journey: login → Franchise Screening → 4-step intake (≤5 sites) → run dashboard → per-site page with
  5 tabs (Territory Guard · Lease Benchmark · Daypart · White-Space · Analysis [AI write-up + PDF]).
- Pipeline: `lib/modules/orchestrator.ts` — time-boxed 5.5s slices, client re-invokes until `complete`.
  Per-site modules isolated; site done = `candidate_site.analyzed_at`. AI write-up is a SEPARATE
  per-site request (`POST /api/analysis-report`), locked against double-billing.
- Tests: 320/320 (vitest). Typecheck clean except a pre-existing cast in `tests/unit/analysisContext.test.ts:117`.

## Code-review fix programme (started 2026-09-23)

| Batch | Scope | Status |
|---|---|---|
| 1 | Security: admin role gates, fail-closed AUTH_SECRET, demo logins off when deployed, login/register rate limits, 10-char passwords, security headers/CSP, brand privacy (`franchisor.created_by_user_id`), dump removed from git | ✅ done · pushed (commit `eb23b13`) |
| 2 | AI runtime: no AI inside the run route, one site per request, per-site lock, regenerate (3/site/day), read-only PDF + status GET, safe errors, strict `AI_PROVIDER`, usage log status/latency | ✅ code done · **not yet committed** |
| 3 | Scoring/pipeline: evidence confidence (not always Low), lease value score + recompute on asking rent, per-module isolation, `analyzed_at` resume, `failed` status, stale-score clearing, outlet ownership per intake, Re-run analysis (refresh) | ✅ code done · **not yet committed** |
| 4 | Truth Layer + guardrails: demographics/lease-comp labels, `?? 0` fake zeros, default-corridor flag, "likely overpaying" price-verdict copy, RA 9646, AI output number check, send retrieved chunks to VectorShift | ⏳ next |
| 5 | Hygiene: dead code (IntakeWizard, TriangulationOverlay, rankWhiteSpace v1, pgvector unused), root repro/verify scripts, local-FS storage on Netlify, two report systems, test type error, docs refresh | ⏳ |

## Pending owner actions (carry forward until confirmed)

1. `npx prisma generate` then `npx prisma migrate deploy` — applies 3 new migrations:
   `20260923000000_franchisor_creator`, `20260923000001_pipeline_usage_status`,
   `20260923000002_pipeline_integrity` (all additive, idempotent, with backfills).
2. Netlify: `AUTH_SECRET` (32+ chars) must be set — deploys without it now refuse sign-in.
   Check function timeout ≥ 26s, else lower `VECTORSHIFT_TIMEOUT_MS` below it.
3. Browser smoke test after deploy: maps + fonts load (CSP); submit an intake; Analysis tab shows
   the write-up; dashboard "↻ Re-run analysis" works. If CSP blocks something: `BSA_CSP_REPORT_ONLY=1`.
4. GitHub repo → Private (if not done). Rotate passwords of real accounts that were in the old dump.
5. Existing runs keep their old scores/confidence until re-run (dashboard "↻ Re-run analysis").

## Key decisions (don't undo without the user)

- **Confidence** = decision-weighted evidence (Verified 1 · Assumed 0.7 · Projected 0.35 · missing 0;
  High ≥ 0.75, Medium ≥ 0.5; −1 band for on-ground flags/failed modules). Typical good run = Medium;
  missing demand data = Low. Implemented in `lib/modules/scorecard.ts`.
- **Lease** counts in the composite only once the user enters an asking rent; stored score is a VALUE
  score (100 − rent percentile).
- **Outlets**: NULL `intake_submission_id` = brand reference network (shared); typed outlets belong to
  their intake and only that run sees them.
- **Brands**: `created_by_user_id` NULL = shared catalog; set = private to creator + staff.
- **AI**: VectorShift only for the Analysis Report; prompts live inside the VS pipeline; app sends the
  schema text. Stub is the default. Unknown `AI_PROVIDER` throws.
- Demo logins never work on deployments unless `BSA_ALLOW_DEMO_LOGINS=1` (admin/analyst never).

## Workflow conventions

- After each batch: update `WORKLOG.md` (entry at top) + rewrite this file + give the user
  PowerShell-safe git commands (one command per line — PowerShell 5 has no `&&`).
- Verify in the cloud sandbox: copy to `/tmp/bsa`, `npm ci`, `prisma generate` with dummy engine env
  vars (`PRISMA_SCHEMA_ENGINE_BINARY` / `PRISMA_QUERY_ENGINE_LIBRARY`), then `tsc --noEmit` + `vitest run`.
- Never edit `2 - Data Intake`; code only in `4 - Final Application`.
