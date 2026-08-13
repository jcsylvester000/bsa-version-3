# QA Journey Findings — Market-Ready Workflow

**Date:** 2026-08-06
**Scope:** The market-ready workflow overhaul — user registration & login, first-run
onboarding tour, results help-tooltips, and run ownership + version history — plus a
regression pass on the core pipeline. **Updated** with the data-ownership / access
lockdown pass (see "Persistence & ownership lockdown" at the bottom).

Harness: `scripts/qa_market_ready.ts` (runs against the real Docker/dev DB, then
cleans up the test rows it creates). Result artifact: `/tmp/qa_market_ready_result.json`.
Latest run: **24/24 checks pass**, `tsc` clean, `next build` OK, `vitest` 232/232.

---

## Result summary

| Gate | Area | Checks | Status |
|------|------|--------|--------|
| 1 | Registration | 5/5 | ✅ |
| 2 | Login (password verify) | 2/2 | ✅ |
| 3 | First-run onboarding flag | 2/2 | ✅ |
| 4 | Run ownership + access boundary | 8/8 | ✅ |
| 5 | Edit-and-rerun versioning | 4/4 | ✅ |
| 6 | Franchise template prefill | 2/2 | ✅ |
| 7 | Pipeline regression | 1/1 | ✅ |
| **Total** | | **24/24** | ✅ **ALL GREEN** |

Supporting verification: `tsc --noEmit` clean, `next build` succeeded, `vitest run`
**232/232** unit tests pass (including `franchiseTemplate`).

---

## What each gate proves

**1 — Registration.** A new account is created with the `franchisor` role, its password
is stored **bcrypt-hashed** (never plaintext — verified the stored value begins `$2a$`),
`hasOnboarded` defaults to `false`, and a bare username is stored as a unique
`<username>@local` email key. A duplicate username is rejected by the unique constraint.

**2 — Login.** The correct password verifies against the stored hash; a wrong password
is rejected. This is the same `verifyPassword` the login route uses. The existing mock
user (`bsa-demo-1234`) remains available for testing alongside real accounts.

**3 — Onboarding.** A brand-new user starts with `hasOnboarded = false`, which is what
drives the first-run guided tour in the app shell. Completing (or skipping) the tour
POSTs to `/api/auth/onboarding` and sets the flag `true`, so it never auto-plays again.

**4 — Ownership + access boundary.** An intake and its run both carry `createdByUserId`.
The "My Runs" list returns the user's own run and does not leak a second user's run on the
same brand. The access boundary itself is proven via `canAccessRun` (what every read now
calls): the creator opens their own run, a different user is **blocked** from it even on a
shared catalog brand, staff retain oversight, and legacy null-owner runs resolve only for
the owning franchisor.

**5 — Versioning.** The first intake of a lineage is v1. An edit-and-rerun produces v2
pointing at the v1 root; an edit-of-the-edit produces v3 **still anchored to the v1
root** (not chaining to v2). History is retrievable in order (`[1,2,3]`). This is the
exact logic the intake API uses, so the UI's version chips reflect real lineage.

**6 — Template prefill.** A brand with imported requirements (test run resolved
**Chowking**) produces a prefill covering the core intake sections, and the footprint
maps to a canonical option string (`"80–150 sqm (large)"`) rather than a raw value — so
"Use this template" lands valid selections the wizard accepts.

**7 — Regression.** A shared-catalog brand still runs the **full pipeline to `ready`**
through the new ownership/versioning code paths — the account changes did not disturb
the core analysis.

---

## Changes shipped in this pass

- **`components/OnboardingTour.tsx`** (new) — first-run guided walkthrough: 6 short
  call-outs with Skip / Back / Next, a spotlight ring around real left-rail features
  (via `data-tour` anchors), progress dots, and step counter. Plays once per new user.
- **`app/api/auth/onboarding/route.ts`** (new) — marks `hasOnboarded = true`; no-op-ok
  for mock users.
- **`app/(app)/layout.tsx`** — looks up `hasOnboarded` for real users and mounts the tour.
- **`components/SidebarNav.tsx`** — `data-tour` anchors on Intake / Runs / Territory /
  Reports for the spotlight.
- **Info tooltips (`components/InfoHint.tsx`)** placed on the results that need a
  "how to read this" explainer: Ranked shortlist, Territory Guard verdict, Lease
  Benchmark verdict, Daypart demand curve, White-Space gaps.

## How to update your local DB

The schema columns for this workflow are applied via migrations
`20260806000000_add_franchisor_requirements` and
`20260806010000_user_ownership_versioning_onboarding`. On your machine:

```bash
# 1) apply migrations (adds requirements, created_by_user_id, parent_intake_id,
#    version, has_onboarded + indexes)
npx prisma migrate deploy

# 2) re-seed to attach the 20 franchise-brand templates + brand catalog
npm run db:seed
```

Both steps are idempotent — safe to re-run.

## Notes / non-blocking

- The harness intentionally triggers one `prisma:error` line (the duplicate-email
  rejection test). That is a **passing** assertion, not a failure.
- Mock users have no DB row, so the tour never shows for them and the onboarding
  endpoint returns ok without a write — by design.

---

## Persistence & ownership lockdown (follow-up pass)

**Trigger:** a review of "does everything a user does save to their account?" We audited
every DB write and every read path.

### What we confirmed already persists
Intakes, pipeline runs, module results (Territory, Lease, Daypart, White-Space, Site-Fit,
Scorecard), AI generations, and the 9-section report all write to Postgres today. Reports
store a metadata row + object-storage pointer (the markdown/PDF blob lives in storage).
Nothing analysis-related is memory-only. **Explore** is search-only and saves nothing by
design.

### The real gap we found: ownership was not enforced on reads
Only intakes/runs carried `createdByUserId`, and it was enforced in exactly ONE place
(the My Runs list). Every detail/report/module read authorised by *brand* via
`canAccessFranchisorShared`, which treats the seeded catalog brands (76 of 77 are
ownerless) as public. Net effect: any logged-in user with a run ID could open another
user's run, report, per-site modules, and intake inputs on a shared brand.

### The fix (private-to-creator, chosen by the product owner)
- **New `canAccessRun(user, run)`** in `lib/auth/auth.ts` — a run (and everything hanging
  off it) is accessible only if the user is staff (admin/analyst), created the run, or
  (for legacy null-owner rows) owns the run's franchisor. Shared-brand runs are **no
  longer public**: two users both analysing Jollibee each see only their own run.
- **Every read path routed through it:** pages `runs / site / reports / lease-benchmark /
  scorecard / modules / territory-guard / whitespace / daypart`; API routes `runs (list)
  / modules / scorecard / reports / territory-guard / runs/[id]/run / lease-benchmark /
  intake/[id]`. The `!session ||` short-circuits now deny instead of granting.
- **`GET /api/runs` list** aligned to the same `createdByUserId` scope as the page (they
  previously disagreed).
- **Explore outlet search** scoped to the caller's own franchisor (POIs stay shared
  reference); a tenant can no longer enumerate another tenant's branch names/coordinates.
  Staff still match across all outlets.
- **`canAccessFranchisorShared`** marked `@deprecated` for run reads (retained for any
  brand-level "is this shared" check).

### Verification
`scripts/qa_market_ready.ts` gate 4 now proves the boundary directly via `canAccessRun`:
creator opens own run ✅, a different user is **blocked** from it on the same shared brand
✅, staff retain oversight ✅, legacy null-owner runs resolve for their franchisor only ✅.
Result: **24/24**. Full regression: `tsc` clean, `next build` OK, `vitest` 232/232.

### Deliberately left shared (not a leak)
Franchise-requirement templates (`GET /api/franchisors/[id]`) and the brand catalog are
shared reference data — every user picks brands from the same catalog and uses the same
templates. Those routes expose only brand identity + template benchmarks, never
user-private rows.
