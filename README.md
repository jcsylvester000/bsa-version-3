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
(PostGIS + pgvector) · Tailwind · hosted on **Netlify** (`@netlify/plugin-nextjs`). AI: VectorShift
pipeline (Anthropic) behind a provider switch, stub by default. Local Postgres via Docker is optional.

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
| `npm test` | Vitest unit suite (331 tests) |
| `npm run prisma:deploy` | apply migrations |
| `npm run db:seed-methodology` | refresh ONLY the AI methodology corpus (safe on Neon) |
| `npm run db:populate:ncr` | load NCR reference data (zonal, demographics, lease) |
| `npm run db:ingest:osm` | ingest POIs from OpenStreetMap (slow, polite) |
| `npm run db:seed-cannibalization` / `db:seed-traffic` / `db:enrich-age` | individual reference seeds |
| `npm run db:validate` | data-quality checks |

## Deploy (Netlify)

Push to `main` → Netlify builds (`npx prisma generate && npm run build`). Required env vars in Netlify:
`DATABASE_URL` (Neon), `AUTH_SECRET` (32+ chars — a deploy without it refuses sign-in), `AUTH_MODE=db`,
`AI_PROVIDER` (`stub` or `vectorshift`) and, for VectorShift, `VECTORSHIFT_API_KEY` +
`VECTORSHIFT_PIPELINE_ID`. Run `npx prisma migrate deploy` against Neon after pulling new migrations.
Keep the function timeout ≥ 26 s (or lower `VECTORSHIFT_TIMEOUT_MS` below it).

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
