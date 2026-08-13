# BSA — Business Site Analysis

Grid Property Ventures · the next version of the Business Site Locator, rebuilt on
Grid's production stack. This repository is the **development-ready foundation** the
agency hands to Grid's development team — a functional prototype with a coherent
design flow and a working backend, not a production deployment.

## What's in this milestone

The first build delivers the foundation plus the #1 requested capability end to end:

- **Full 16-table Postgres schema** (Prisma) in five groups, with the Truth Layer as
  a column on every reference and result row, geo indexes (GiST) and vector indexes
  (HNSW) applied.
- **Auth + API-first layer** — JWT + bcrypt, four roles, franchisor-scoped access,
  every endpoint Zod-validated with a consistent response envelope.
- **Intake wizard** — vertical picker, sections A–K with a live 80% completeness gate,
  outlet CSV upload, candidate sites; writes typed rows with `geom` computed on write.
- **Territory Guard (P1)** — measures trade-area overlap against the existing network
  (Verified), estimates cannibalization (Projected), renders overlap rings on a map
  and states a plain verdict (adds / mixed / redistributes).
- **Retrieve-then-generate AI** — a stub provider behind a clean interface phrases the
  verdict strictly from retrieved, classified data; every call is logged for provenance.

## Tech stack (fixed — do not change without explicit instruction)

Next.js 14 (App Router) · React 18 · TypeScript (strict) · Prisma · PostgreSQL +
pgvector + PostGIS · Tailwind (Grid brand tokens). Production target is neon.tech;
local development uses Docker Postgres. Switching between them is a config change only
(see `lib/db/prisma.ts`).

## Quick look inside (mock mode — no database)

To just see the application, you don't need Postgres at all:

```bash
npm install
npm run dev          # http://localhost:3000
```

With no `.env` (or `AUTH_MODE=mock`), login runs in **mock mode**: the four demo
accounts below work with no database, and the Runs screen shows demo data. Sign in as
`owner@kantofreshcup.test` / `bsa-demo-1234`. Navigation, the runs list, intake, and both
feature screens are browsable. Note: the **Run** buttons on Territory Guard and Lease
Benchmark still need a real database to compute — set up Postgres (below) to see those
produce results.

## Full local setup (with database)

Prerequisites: Node 20+, Docker (for local Postgres).

```bash
# 1. Install
npm install

# 2. Start local Postgres (pgvector + PostGIS + citext + pg_trgm)
docker compose up -d

# 3. Configure env
cp .env.example .env
#   set AUTH_MODE=db to use real seeded users (mock is the default without a DB)
#   set AUTH_SECRET:  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
#   leave AI_PROVIDER=stub to run with no external keys

# 4. Migrate + seed demo data + ingest reference data
npm run prisma:deploy
npm run db:seed
npm run db:ingest          # loads sample POI / zonal / demographics (idempotent)

# 5. Run
npm run dev          # http://localhost:3000
```

### Demo accounts (from the seed)

| Email | Role | Sees |
|-------|------|------|
| `admin@grid.test` | admin | everything |
| `analyst@grid.test` | analyst | everything |
| `owner@kantofreshcup.test` | franchisor | only Kanto Freshcup |
| `broker@grid.test` | broker | only Kanto Freshcup |

Password for all demo users: `bsa-demo-1234`.

Walk the journey: sign in → **Runs** → open the Kanto Freshcup run → **Run Territory
Guard**. The "BGC 7th Ave" candidate returns ~75% overlap and a *redistributes* verdict;
the "Alabang" candidate returns 0% and *adds*.

## Scripts

| Script | Does |
|--------|------|
| `npm run dev` / `build` / `start` | Next.js dev / production build / serve |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Vitest unit suite (geo, Truth Layer, territory, completeness) |
| `npm run prisma:deploy` | apply migrations |
| `npm run db:seed` | load demo data |
| `npm run db:reset` | drop, re-migrate, re-seed |

## Layout

```
app/            App Router — (auth) login, (app) runs/intake/territory-guard, api/*
components/     React components (map, wizard, Truth chip, nav)
lib/            server logic — db, auth, geo, modules, ai, truth, validation, api
prisma/         schema, migration (with geo/vector DDL), seed
types/          shared contract types
tests/          vitest unit tests + integration smoke script
docs/           data dictionary, API reference, security posture
```

## Non-negotiables honoured

- **API-first** — the browser never holds a secret or touches Postgres directly.
- **Truth Layer is structural** — a column on the row, carried into the AI context and
  onto every displayed value; the AI phrases, it never invents a number.
- **Development-ready, not production** — clear structure and documented decisions over
  clever shortcuts. See `docs/` and `WORKLOG.md`.

See `WORKLOG.md` for what was built, decisions made, and the next open steps.
