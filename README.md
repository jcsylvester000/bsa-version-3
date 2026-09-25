# BSA — Business Site Analysis

Grid Property Ventures · the next version of the Business Site Locator. This repository is the
**development-ready foundation** handed to Grid's development team: a functional prototype with a
coherent design flow and a working backend, not a production deployment.

**Start here:** [`docs/HANDOFF.md`](docs/HANDOFF.md) (architecture, journey, decisions, open items) ·
[`PROJECT_MEMORY.md`](PROJECT_MEMORY.md) (current state) · [`WORKLOG.md`](WORKLOG.md) (full history).

## What BSA does

A Filipino broker, franchisor or franchisee screens franchise brands, enters an intake with up to five
candidate sites, and gets — per site — Territory Guard (cannibalization), Lease Benchmark (rent vs
corridor + BIR zonal cross-check), Daypart demand, White-Space (better alternative areas), a weighted
Go / Caution / No-Go composite, and an AI-written analysis grounded only in those figures. Every figure
carries its **Truth Layer** (Verified / Assumed / Projected). BSA supports the licensed broker (RA 9646);
it never gives price verdicts, and BIR zonal values are shown only as tax-reference floors.

## Tech stack (fixed — do not change without explicit instruction)

Next.js 14 (App Router) · React 18 · TypeScript (strict) · Prisma 5 · PostgreSQL on **neon.tech**
(PostGIS + pgvector) · Tailwind · hosted on **Netlify** (`@netlify/plugin-nextjs`). Local Postgres via
Docker is optional.

**Recommendation engine:** deterministic, no external LLM. Each site's call (Proceed / Proceed with
caution / No-Go) comes from the module scores → the scorecard composite band → `lib/modules/siteVerdict.ts`,
which phrases the verdict from keywords, findings and data. See "How the recommendation is decided" below.
The old external VectorShift analysis endpoint was removed (Sep 2026).

## Run it locally

Prerequisites: Node 20+. For a local database, Docker; or point `DATABASE_URL` at Neon.

```bash
npm install
cp .env.example .env          # fill in values (names only are committed)
npx prisma generate
npx prisma migrate deploy     # applies every migration in prisma/migrations
npm run dev                   # http://localhost:3000
```

- **No database at all?** Leave `DATABASE_URL` unset (or `AUTH_MODE=mock`): the four demo logins in
  `.env.example` work locally with sample data. Demo logins are **disabled on any deployment**.
- **Empty database only:** `npm run db:setup-neon` (migrate + full seed, which includes `db:seed`). ⚠️ `npm run db:seed`
  resets demo intakes/outlets and sample lease comps — never run it on a shared database.

## Scripts

| Script | Does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest unit suite (470+ tests) |
| `npm run prisma:deploy` | apply migrations |
| `npm run db:seed-methodology` | refresh ONLY the AI methodology corpus (safe on Neon) |
| `npm run db:populate:ncr` | load NCR reference data (zonal, demographics, lease) |
| `npm run db:ingest:osm` | ingest POIs from OpenStreetMap (slow, polite) |
| `npm run db:seed-cannibalization` / `db:seed-traffic` / `db:enrich-age` | individual reference seeds |
| `npm run db:validate` | data-quality checks |

## Deploy (Netlify)

Push to `main` → Netlify builds (`npx prisma migrate deploy && npx prisma generate && npm run build`).
Required env vars in Netlify: `DATABASE_URL` (Neon, pooled), `DIRECT_URL` (Neon direct — used by
`prisma migrate deploy` and the bulk loaders), `AUTH_SECRET` (32+ chars — a deploy without it refuses
sign-in), `AUTH_MODE=db`, `GOOGLE_API_KEY` (Places/Geocoding/tiles proxy). Optional: `ERROR_WEBHOOK_URL`
or `SENTRY_DSN` (error monitoring, F-51). No AI keys are needed — the recommendation is deterministic.
Keep the function timeout ≥ 26 s (the pipeline slice budget).

## How the recommendation is decided (deterministic)

No model invents the call. For each candidate site:

1. **Modules score independently** (0–100 each, with a Truth Layer of Verified / Assumed / Projected):
   Site Fit, Territory Guard, Lease Benchmark, Daypart & Seasonality, White-Space, and the
   category modules (Mall, Healthcare, Informal, Land) where the vertical activates them.
2. **The scorecard composites** the scored modules into one 0–100 value and a band
   (`lib/modules/scorecard.ts` → `scorecardBand`): **go ≥ 65**, **caution ≥ 45**, else **nogo**;
   `insufficient` when the primary demand read is missing.
3. **`lib/modules/siteVerdict.ts` (`summariseSite`)** turns that band into the Proceed / Proceed with
   caution / No-Go call and phrases the Final Report from the retrieved keywords, findings and numbers —
   never inventing a value. The dashboard band and the Final Report always agree (they read the same band).

Guardrails hold throughout: no price verdicts (lease is positional only), BIR zonal is a tax-reference
floor, and broker supplementation / RA 9646 framing is preserved. Every number keeps its Truth Layer.

## Regional data-load runbook

`docs/HANDOFF.md` and `prisma/data/*/README.md` have the details; the one-province order is:
boundaries → OSM ingest (competitors + `--transport`, in a quiet window) → PSA demographics → BIR zonal →
lease comps → malls → traffic AADT, then re-run an intake for that province. NCR is loaded via
`npm run db:populate:ncr`; Cavite/Batangas use the `--region=` variants.

## Layout

```
app/(auth)      login / register
app/(app)       screening · intake · runs (dashboard) · site (5 tabs) · modules · scorecard · reports · explore · settings
app/api/*       every server entry point (Zod-validated, one response envelope)
components/     React components (maps, wizard, site tabs, report views)
lib/            server logic — auth, db, modules (pipeline + math), ai, truth, geo, places, storage
prisma/         schema, migrations, seeds/ingest, reference data JSON
tests/unit/     Vitest suite
docs/           HANDOFF, API reference, data dictionary, security posture, qa-history/
```
