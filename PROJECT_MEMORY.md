# BSA — Project Memory (current state)

**Read this first in every new thread**, after the Master Instruction. It is the short,
always-current snapshot. `WORKLOG.md` is the full history (newest first). This file is
rewritten at the end of every work batch — if it disagrees with older notes (e.g.
`2 - Data Intake/Migration Guide/PROJECT_MEMORY_EXPORT.md`, 2026-08-10), **this file wins**.

_Last updated: 2026-09-23 — after Fix Batch 5 (review programme complete)._

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

## Code-review fix programme (started 2026-09-23)

| Batch | Scope | Status |
|---|---|---|
| 1 | Security: admin role gates, fail-closed AUTH_SECRET, demo logins off when deployed, login/register rate limits, 10-char passwords, security headers/CSP, brand privacy (`franchisor.created_by_user_id`), dump removed from git | ✅ pushed (`eb23b13`) |
| 2 | AI runtime: no AI inside the run route, one site per request, per-site lock, regenerate (3/site/day), read-only PDF + status GET, safe errors, strict `AI_PROVIDER`, usage log status/latency | ✅ pushed (`c5ccfaf`) |
| 3 | Scoring/pipeline: evidence confidence (not always Low), lease value score + recompute on asking rent, per-module isolation, `analyzed_at` resume, `failed` status, stale-score clearing, outlet ownership per intake, Re-run analysis (refresh) | ✅ pushed (`c5ccfaf`) |
| 4 | Truth Layer + guardrails: honest demographic/lease/territory labels, no fake zeros, proxy-corridor flag, positional lease labels (no price verdicts), RA 9646 disclaimers, zonal-floor wording, AI output check, reference sent to VectorShift; mall ≤3 km, daypart all-day range, canonical zoning city, concept-aware informal | ✅ pushed (`fb4e312`) |
| 5 | Hygiene + hotfix: hydration #418 (Manila-time formatter), non-fatal usage log + reason codes for AI 502s, maptiles 200-when-off; reports on demand (no storage) + both kept & relabelled; report PII via POST; retired 4 pages + 5 components + root scripts; Lease tab saves asking rent; rankWhiteSpace v1 removed; README + HANDOFF + security/API docs | ✅ code done · **not yet committed** |

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
- **AI**: VectorShift only for the Analysis Report; prompts live inside the VS pipeline (mirror docs in
  `3 - Skills/10 - AI Systems Engineer/`); app sends schema + interpretation reference as one text input
  (`VECTORSHIFT_SEND_REFERENCE=0` = schema only). Stub is the default. Unknown `AI_PROVIDER` throws.
- Demo logins never work on deployments unless `BSA_ALLOW_DEMO_LOGINS=1` (admin/analyst never).
- **Guardrail wording** lives ONLY in `lib/truth/guardrailCopy.ts` (lease position labels, zonal floor note,
  RA 9646 disclaimers, price-verdict patterns). Lease is described by position vs the corridor, never
  judged. The AI output check (`lib/ai/outputCheck.ts`) warns, it does not block.
- **Truth labels come from the data rows** (demographics, comps, outlets), never hard-coded; missing values
  show "—", never 0.

## Workflow conventions

- Next (not started): see `docs/HANDOFF.md` §4 — pgvector hybrid retrieval, White-Space SQL-side tiering,
  API-first page data, nonce CSP, session revocation, S3/R2 only if uploads return. Skill folder
  `3 - Skills/12 - Orchestration and Delivery Lead` is still EMPTY (no SKILL.md) — offer to write it.
- After each batch: update `WORKLOG.md` (entry at top) + rewrite this file + ALWAYS give the user the
  GitHub update commands (`git add -A` / `git commit -m "…"` / `git push origin main`) plus any DB commands,
  PowerShell-safe (one command per line — PowerShell 5 has no `&&`).
- Verify in the cloud sandbox: copy to `/tmp/bsa`, `npm ci`, `prisma generate` with dummy engine env
  vars (`PRISMA_SCHEMA_ENGINE_BINARY` / `PRISMA_QUERY_ENGINE_LIBRARY`), then `tsc --noEmit` + `vitest run`.
- Never edit `2 - Data Intake`; code only in `4 - Final Application`.
