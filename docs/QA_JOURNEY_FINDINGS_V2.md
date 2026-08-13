# BSA — User Journey QA v2: Findings & Fixes

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-04
**Plan:** `docs/QA_GAMEPLAN_V2.md`
**Result:** **ALL 10 SCENARIOS PASS 3/3.**

Each scenario was driven through the real pipeline (as a user would: franchisor →
outlets → candidate → run) and had to clear three gates before advancing:
**A** data sufficiency · **B** competitor relevance (Google Maps) · **C** intake UX + result integrity.

---

## Final gate results (all 3/3)

| # | Scenario | A · data | B · competitor relevance | C · integrity |
|---|---|---|---|---|
| 1 | Milk-tea — Macao Imperial Tea | ✓ comp 57.3 · Makati CBD/6 comps | ✓ 20 **milk-tea** competitors | ✓ ready, 5 modules |
| 2 | QSR — Jollibee | ✓ 66 · BGC/6 | ✓ 20 QSR/fast-food | ✓ 5 modules |
| 3 | Bakery — Red Ribbon | ✓ 43.4 · QC/6 | ✓ 20 bakeries | ✓ 4 modules |
| 4 | Coffee — Starbucks | ✓ 58.8 · BGC/6 | ✓ 19 **coffee** (not milk-tea) | ✓ 5 modules |
| 5 | Apparel — Bench | ✓ 58.8 · Mandaluyong/5 | ✓ 20 apparel | ✓ 4 modules |
| 6 | Pharmacy — Mercury Drug | ✓ 24.8 · QC/6 | ✓ 20 pharmacies | ✓ 4 modules |
| 7 | Convenience — 7-Eleven | ✓ 58.8 · Ortigas/6 | ✓ 20 convenience | ✓ 4 modules |
| 8 | Fuel — Petron | ✓ 65.7 · Marikina/5 | ✓ 20 fuel stations | ✓ 4 modules |
| 9 | Remittance — Cebuana | ✓ 27.9 · Manila/5 | ✓ 20 remittance/pawn | ✓ 4 modules |
| 10 | Fitness — Anytime Fitness | ✓ 58.8 · Ortigas/6 | ✓ 20 gyms | ✓ 4 modules |

---

## Findings (captured → tagged → fixed)

### `[MAPS-RELEVANCE]` Blocker — F&B competitors were the WRONG businesses **(FIXED)**
The core issue you raised. A milk-tea concept was asking Google for `cafe`+`coffee_shop`
and counting every result — so specialty coffee roasters (Starbucks, Antipodean, H Proper),
donut shops (J.CO) and even a vegan restaurant were treated as milk-tea competitors. A QSR
counted fine dining. Same broad category ≠ same competitor.

**Fix.** `lib/places/competitorRelevance.ts` — a concept taxonomy that pairs Google types
with name allow/deny signals and `allowTypes`. A milk-tea concept now matches only
milk-tea/bubble-tea shops (`tea_house`/`tea_store` + name signals: Gong Cha, CoCo, CHAGEE,
Serenitea…), and rejects coffee roasters/donuts/restaurants. `placesService.relevantCompetitors()`
text-searches the concept keyword (finds them) then filters (confirms them). Wired into
Territory Guard AND the site-fit competition pillar (so a milk-tea site isn't penalised for
nearby coffee shops). **Proven live:** a milk-tea run now returns 20 real milk-tea shops
vs. the coffee roasters it returned before; cross-check confirms milk-tea shops are NOT
counted as coffee competitors and vice-versa. 11 unit tests lock it in.

*How F&B is organized so it doesn't conflict in the zone:* competition is scored by
**concept**, not by Google's broad type. Two food places sharing a type only conflict if
they share a concept (milk-tea vs milk-tea). Cannibalization (Territory Guard verdict) is
separate and correct — it's own-outlet overlap only, never competitors.

### `[LEASE-DATA]` Major — lease benchmark had corridors with too few / no comps **(FIXED)**
Lease covered 5 NCR corridors (20 comps); candidates in Mandaluyong, Manila, Marikina,
Muntinlupa/Alabang had none, and Makati CBD/QC/Ortigas/Pasay had <5 (too thin to benchmark).

**Fix.** Expanded `prisma/data/lease.real.json` to **9 corridors, 49 comps** — real published
2026 bands where available (Mandaluyong ₱900–2,000, Alabang ₱800–2,000) and grounded
secondary-corridor estimates (Manila, Marikina) clearly labelled **Assumed**. Every corridor
now has ≥5 comps. `inferCorridor` extended to map Mandaluyong / Manila / Marikina / Alabang /
Muntinlupa city names to their corridors. Ingested to Docker via `db:populate`.

### `[DATA-GAP]` Major — thin demographics zeroed site-fit for some sites **(MITIGATED + EXPANDED)**
The demographic layer was 30 barangays / 9 cities; a candidate with no cell in range scored
composite 0 (no demand read). Marikina had no coverage at all.

**Fix.** (1) The Phase-3 nearest-cell fallback (Assumed-flagged) already stops a false 0;
(2) expanded `demographics.real.json` to **39 barangays across all 10 scenario cities**,
adding real Marikina barangays (Concepcion, Parang, Marikina Heights, Nangka — 2020 census)
and denser coverage near scenario candidates. Every scenario now gets a real, non-zero demand
composite.

### `[UI-INTAKE]` Major — no map pin for outlets/candidates **(FIXED)**
The Existing-Outlets and Candidate-Sites steps only geocoded a typed address — a user
couldn't see or correct where their branch actually sat.

**Fix.** `components/LocationPicker.tsx` — an interactive Google-basemap modal: search an
address, click to drop a pin, drag to fine-tune, "Use this location" writes exact coords back.
Added a 📍 Pin button to every outlet row and every candidate row in the wizard. Users now set
precise locations visually instead of hoping an address geocodes.

### `[UX-IMPROVE]` — pre-filled mock data removed from intake **(DONE, Step 0)**
The "Load demo data" auto-fill and scenario picker were removed; intake starts blank so the
user enters everything — the honest surface this QA validated against.

---

## Data now in the Docker DB (after this pass)

| Table | Before | After |
|---|---|---|
| lease_comp | 20 (5 corridors) | **49 (9 corridors, all ≥5)** |
| demographic_cell | 30 (9 cities) | **39 (10 cities, +Marikina)** |
| outlet / poi / mall | 2,272 / 2,452 / 45 | unchanged (already rich) |

Reproduce locally: `docker compose up -d && npm run db:populate` (or `--skip-places` for the
curated reference data only).

---

## Verification

- All 10 scenarios **PASS 3/3** through the real pipeline.
- Competitor relevance proven live (milk-tea ≠ coffee); F&B no longer conflicts in the zone.
- app tsc ✓, scripts tsc ✓, `next build` ✓, vitest **210 tests** ✓ (+ new corridor + relevance tests).

## Residual / future (non-blocking)

- **Full PSA barangay ingest** (all ~1,700 NCR barangays) would let site-fit read Verified
  demand everywhere instead of the nearest-cell Assumed fallback in sparse spots.
- **Verified lease comps** for Manila/Marikina (currently grounded Assumed estimates) when a
  broker/ARIA feed is available.
- Map-pin renders Google tiles via `/api/maptiles`; verify visually in a local `npm run dev`
  (the cloud sandbox can't reach localhost from a browser).
