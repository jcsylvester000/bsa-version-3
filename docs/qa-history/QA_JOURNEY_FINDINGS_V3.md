# BSA — User Journey QA v3: Findings & Fixes (Round 2, 10 NEW scenarios)

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-04
**Plan:** `docs/QA_GAMEPLAN_V3.md`
**Result:** **ALL 10 NEW SCENARIOS PASS 3/3.**

10 brand-new scenarios — none reused from Round 1 — drawn from the Excel demand clusters,
deliberately leaning into the 9 clusters Round 1 never tested. Same 3 gates, 3/3 to advance.

---

## Final gate results (all 3/3)

| # | New scenario | Cluster (new?) | A · data | B · competitor relevance | C · integrity |
|---|---|---|---|---|---|
| 1 | Chowking | Chinese-QSR | ✓ 43.4 · QC/6 | ✓ 16 **Chinese fast-food** (not burger QSR) | ✓ 5 mods |
| 2 | Max's Restaurant | Casual dining ⭑ | ✓ 57.3 · Makati/6 | ✓ 20 **sit-down** (not fast-food/cafe) | ✓ 5 mods |
| 3 | Gong Cha | Milk tea | ✓ 58.8 · BGC/6 | ✓ 20 milk-tea (not coffee) | ✓ 5 mods |
| 4 | Watsons | Pharmacy | ✓ 58.8 · Ortigas/6 | ✓ 20 pharmacies | ✓ 4 mods |
| 5 | David's Salon | Salon ⭑ | ✓ 58.8 · Makati/6 | ✓ 20 salons | ✓ 4 mods |
| 6 | Ace Water Spa | Spa ⭑ | ✓ 24.8 · QC/6 | ✓ 20 spas | ✓ 5 mods |
| 7 | Hi-Precision | Diagnostics ⭑ | ✓ 43.4 · QC/6 | ✓ 20 clinics/labs | ✓ 4 mods |
| 8 | Go Hotels | Hotel ⭑ | ✓ 7.8 · Manila/5 | ✓ 20 hotels | ✓ 4 mods |
| 9 | Kumon | Education ⭑ | ✓ 58.8 · Marikina/6 | ✓ 20 schools/review | ✓ 4 mods |
| 10 | Aquabest | Water station ⭑ | ✓ 43.4 · QC/6 | ✓ 20 water stations | ✓ 3 mods |

⭑ = cluster Round 1 never tested. All 10 pass on the real pipeline.

---

## Findings (captured → tagged → fixed)

### `[MAPS-RELEVANCE]` Major — new F&B & niche concepts needed their own discriminator **(FIXED)**
Round 1 fixed milk-tea vs coffee. Round 2's new brands exposed more same-category-different-
concept cases:
- **Chowking (Chinese-Filipino QSR)** would have counted every fast-food place (incl. burger
  QSR) as a competitor. It should compete with Chinese fast food (Panda Express, Ling Nam,
  Chuan Kee) only.
- **Max's (casual/full-service dining)** would have been lumped with QSR. A sit-down family
  restaurant competes with other sit-down restaurants, not with kiosks/fast food.
- **Aquabest (water station)** — Google types these as `supplier`/blank, so a type-only pull
  is noise; the name is the true discriminator.

**Fix.** Added four concepts to `lib/places/competitorRelevance.ts` — `chinese_qsr`,
`casual_dining`, `water`, and refined `diagnostics` (real `medical_clinic`/`medical_lab`
types). `conceptFor` now sub-routes `fnb_qsr` by name (Chinese vs casual vs plain QSR) and
routes water stations. **Proven live:** Chinese-QSR keeps 9/12 Chinese fast-food and drops
burger QSR; casual dining keeps 12/12 sit-down and drops fast-food/cafes; water keeps 12/12
water stations. 7 new unit tests.

### `[CORRECTNESS]` — Go Hotels scored low (7.8): verified HONEST, not a bug **(NO FIX NEEDED)**
The hotel scenario returned a low site-fit composite. Investigated: the Manila-Ermita
candidate has **20 real hotels within 800 m** (Diamond, Sheraton, Bayview, Red Planet, New
Coast…) and low residential population (7,000). A saturated hotel corridor genuinely offers
low competition-headroom for a new budget hotel — the model is correct and the concept
discriminator correctly identified all 20 as hotel competitors. Documented as expected
behaviour; a hotel-specific "demand driver" pillar (tourism flow) is a future enhancement,
not a defect.

### `[DATA-GAP]` — no new gaps this round **(none)**
Because Round 1 expanded lease to 9 corridors (all ≥5 comps) and demographics to all 10 NCR
cities (incl. Marikina), every Round-2 candidate resolved with sufficient data on the first
run. No additional ingestion was needed. (The residual full-PSA-barangay and Verified-lease
items from v2 still stand as future enhancements.)

### `[UX-INTAKE]` — map-pin + concept-aware competition carried over **(reused from v2)**
Every Round-2 scenario used the same real-entry intake (map-pin outlets/candidates) and the
concept-aware competition pillar. Both held up across all new verticals.

---

## Coverage after two rounds

20 distinct scenarios across **19 of the 20 Excel clusters** (only the tiny "Automotive"
overlap remains lightly tested — Rapide/AutoPlus have thin outlet counts). Modules exercised
across both rounds: site-fit, territory, lease, daypart, informal, mall, healthcare,
whitespace, land — the full set.

---

## Verification

- All 10 NEW scenarios **PASS 3/3** on the real pipeline.
- New concepts proven live (Chinese-QSR ≠ burger QSR; casual dining ≠ fast food; water = water).
- app tsc ✓, scripts tsc ✓, `next build` ✓, vitest **217 tests** ✓ (+7 concept tests).

## Residual / future (non-blocking)

- Hotel: a tourism-flow / demand-driver pillar for asset-acquisition use cases.
- Automotive: thin outlet coverage (Rapide/AutoPlus) — pull more if that vertical is prioritised.
- Full PSA barangay demographics + Verified lease comps (carried from v2).
