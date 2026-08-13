# BSA — BRUTAL NCR Market-Readiness Test (QA v6)

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-05
**Status:** DRAFT — awaiting approval before execution.

**Mission:** The extreme test. Prove BSL is **market-ready for ALL 20 Excel business
categories across the ENTIRE NCR region.** Each category is tested from the perspective of
**what that business actually wants to see** (the Excel "Services Sought"), under strict
requirements: the data must exist, the UI (dropdowns + manual input) must capture what the
category needs, and every module must return real — not false or insufficient — results.
If this Brutal Test passes NCR, it becomes the template for other regions.

---

## Scope: the ENTIRE NCR region (all 17 LGUs)

NCR = 16 cities + 1 municipality:
**Manila, Quezon City, Caloocan, Las Piñas, Makati, Malabon, Mandaluyong, Marikina,
Muntinlupa, Navotas, Parañaque, Pasay, Pasig, Pateros, San Juan, Taguig, Valenzuela.**

**Current coverage (audited):** demographics for **10 of 17** cities; lease for 11 corridors;
430 health POIs; 45 malls; 1,737 competitor POIs; 2,272 outlets.
**Gap → must fill for clean passes:** demographics + a lease corridor + zonal for the **7
missing LGUs** — Caloocan, Las Piñas, Malabon, Navotas, Pateros, San Juan, Valenzuela — with
real PSA populations + `daytime_pop` (Daypart/White-Space depend on it), grounded published
lease bands, and BIR zonal. Every NCR candidate must then resolve with real data.

---

## The 20 categories × "what they want to see" × strict pass criteria

Each category is a test case framed by its Excel Services-Sought. It passes only if BSL
delivers what that business demands, with real data and the right UI fields.

| # | Category (brands) | What the business WANTS TO SEE | Modules that must deliver it | Strict pass = |
|---|---|---|---|---|
| 1 | QSR / Kiosk (58) | site validation, defensible territory radius, slot footfall, 1st-yr sales, reusable scorecard | site_fit, territory, daypart, scorecard | overlap varies; scorecard renders; footfall real |
| 2 | Casual Dining (39) | feasibility, income & dining-spend profile, competitor+anchor map, lease bench, ROI/payback | site_fit, territory, lease, mall-adj | income overlay present; lease ≥5 comps |
| 3 | Milk Tea (31) | slot footfall, category saturation in walking radius, min-distance rule, sales forecast | territory, daypart | milk-tea competitors only; min-distance overlap |
| 4 | Bakery / Dessert (26) | household density & income, cannibalization radius, transport proximity, ADDS-volume evidence | site_fit, territory, daypart | add-vs-redistribute clear; density real |
| 5 | Apparel / Retail (15) | mall-tier bench & foot traffic by property, rent+CUSA bench, co-tenancy, mall-vs-high-street | mall, lease | mall tier + CUSA present; lease resolves |
| 6 | Coffee / Cafe (12) | daypart profile, office/residential/campus mix, CBD-vs-suburb lease, cafe count in walk radius | daypart, lease, territory | daypart curve varies by catchment |
| 7 | Pharmacy (8) | healthcare proximity, age & income overlay, competitor pharmacy density, pop-per-branch | healthcare, site_fit, territory | ≥1 real referral facility; pop-per-branch |
| 8 | Spa / Wellness (8) | income-band map, mall tier & traffic, competitor+adjacent map, premium-pricing read | mall, informal, site_fit | premium-viability read; income band |
| 9 | Convenience (7) | region white-space, cannibalization vs stores, competitor map, live site pipeline | whitespace, territory | white-space gaps vary; cannibalization |
| 10 | Fuel / LPG (6) | vehicle traffic & road network, frontage/lot screen, land avail/pricing, zoning | land, site_fit | land screen present; zonal (land) real |
| 11 | Salon / Barber (6) | demographics & income, walkability, competitor incl. INFORMAL, pop-per-chair | informal, site_fit | informal-competitor flag; pop-per-chair |
| 12 | Automotive (5) | vehicle traffic, frontage/lot, vehicle-ownership density, zoning | land, site_fit | land screen; auto competitors |
| 13 | Laundry (4) | residential/condo density, renter-vs-owner mix, competitor radius, breakeven household count | site_fit, informal | renter-share present; breakeven count |
| 14 | Diagnostics (3) | demographic overlay, referral-source map, accessibility & parking, pop-per-facility | healthcare, site_fit | referral facilities; pop-per-facility |
| 15 | Remittance (3) | market/terminal footfall, transport proximity, network white-space, cannibalization | whitespace, territory | white-space + transport proximity |
| 16 | Hotel / Leisure (3) | demand-driver/tourism map, land/building avail, supply pipeline, catchment access | land, site_fit | land screen; honest tourism caveat |
| 17 | Other (3) | site validation, catchment profile, competitor map, territory | site_fit, territory | core modules real |
| 18 | Education (2) | school/university proximity, student density, transport access, competitor review-centre map | daypart, site_fit | school-proximity; term-time daypart |
| 19 | Water Station (2) | tight-radius residential density, competitor station map, breakeven household count | site_fit, informal | tight-radius density; breakeven |
| 20 | Fitness (1) | large-floorplate avail, rent-per-sqm bench, demographics + daytime working-pop, competitor gym | daypart, lease, site_fit | daytime-pop daypart; lease per-sqm |

Every category is run at **≥2 real NCR candidate sites** in different LGUs, so the test spans
the region, not one district.

---

## The UI requirement (dropdowns + manual input) — audited per category

The brief demands the UI captures what each category needs. I will verify, per category, that
the intake wizard offers the RIGHT dropdown option OR a manual field for each Services-Sought
input, and add any missing option. Audited today: 9 dropdown groups / 49 options
(vertical, target customer, income band, footprint, expansion goal, site preference, consent,
outlet format) + manual fields (brand/concept, addresses, sales, coords, map-pin).

Likely UI gaps to close (pre-tagged `[UI-INTAKE]`):
- **Fuel/Automotive/Hotel** — a "land parcel / lot size / frontage" input (land verticals).
- **Apparel/Spa** — a "mall tier / target mall" selector for mall-dependent formats.
- **Salon/Laundry/Water** — a "units (chairs / machines)" manual field for pop-per-unit.
- **Pharmacy/Diagnostics** — a "near clinics/hospitals" site-preference (exists) — verify.
- **Casual dining** — dining-spend / average-ticket manual field (exists as `d`) — verify maps.

Each category must be **completable end-to-end** with the fields present (dropdown or manual).

---

## The 3 gates (brutal bar)

- **Gate A — Data present for a clean pass.** Every NCR candidate resolves with REAL data:
  demographics (incl. `daytime_pop`), a lease corridor ≥5 comps, health POIs where the category
  needs them, zonal for land verticals. No honest-thin fallback counts as a pass HERE — the
  requirement is that the data EXISTS for NCR. Gaps get filled (real, researched) before pass.
- **Gate B — Modules deliver what the category wants (genuine, not false/insufficient).** The
  category's required modules each return real output that VARIES with input and carries honest
  Truth Layers — matched against the Services-Sought row. A module that can't deliver a
  first-class Services-Sought item is a finding to fix or an honest, documented limitation.
- **Gate C — UI + role completability.** The intake captures every needed input (dropdown or
  manual); a user in the right role (broker / AFFI member / franchisor) can complete the
  journey and read a meaningful result. Access scoping holds.

A category passes only 3/3. Because the bar is "market-ready," Gate A is strict: NCR data must
be complete, not merely honestly-flagged.

---

## Execution order

1. **NCR data completion.** Fill the 7 missing LGUs (demographics w/ daytime_pop, lease
   corridor, zonal) with real/grounded data; ingest to Docker. Verify every NCR city resolves.
2. **UI audit + fixes.** Per category, confirm each Services-Sought input has a dropdown/manual
   field; add the missing ones (land parcel, mall tier, units) with tests.
3. **Concept/module coverage.** Ensure each category's modules deliver its wants (extend
   concept taxonomy / add a first-class field where a want isn't yet answered).
4. **Run all 20 categories** × ≥2 NCR candidates through the 3 gates; fix root causes until
   3/3 each. Log tagged findings.
5. **Final pass** — full test suite + build green; `docs/QA_JOURNEY_FINDINGS_V6.md`; deliver
   files + data + `db:populate` commands. Declare NCR market-ready if 20/20 pass.

---

## What this round will hunt (pre-tagged)

- `[DATA-GAP-NCR]` — missing LGU demographics/lease/zonal → fill real.
- `[UI-INTAKE]` — a Services-Sought input with no dropdown/manual field → add it.
- `[MODULE-GAP]` — a category "want" no module delivers as first-class (e.g. pop-per-chair,
  renter-mix surfaced, mall-tier read) → add the surface or document honestly.
- `[MODULE-FALSE / INSUFFICIENT]` — any module giving false/flat/insufficient on NCR data.
- `[ACCESS]` — role leak.

---

## What "done / market-ready" looks like

- All 17 NCR LGUs have real data (demographics incl. daytime_pop, lease, zonal, health POIs).
- All 20 Excel categories pass 3/3 at ≥2 NCR sites each — judged against what each business
  wants to see.
- The intake UI captures every category's inputs via dropdown or manual entry.
- No false or insufficient module output on NCR data.
- `QA_JOURNEY_FINDINGS_V6.md` tags every issue + fix. → Template reusable for other regions.

---

## Approval

Approve to begin, or adjust: the strictness of Gate A (require full NCR data vs allow honest
thin), which UI fields to add, or the per-category emphasis. On approval I start with NCR data
completion, then the UI audit, then run all 20 categories through the gates.
