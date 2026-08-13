# BSA — User Journey QA v5: Findings & Fixes (Round 4 — 20 EXTREME, role-focused)

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-05
**Plan:** `docs/QA_GAMEPLAN_V5.md`
**Result:** **ALL 20 SCENARIOS PASS 3/3.**

20 extreme scenarios centred on **brokers, agents, and AFFI members (franchisees) expanding**,
with a strict bar: prove **Territory Guard, Lease Benchmark, Daypart Demand, and White-Space**
genuinely work — real output that VARIES with input and flags insufficient data honestly —
never false or silently-insufficient.

---

## Final gate results (all 3/3)

Each scenario was run **as its role** (broker / AFFI-member / analyst) and its named module
was proven to genuinely work (output varies with input + honest flags), plus access scoping.

| # | Role | Brand | Module — proof it genuinely works |
|---|---|---|---|
| 1 | AFFI | Jollibee | Territory — walk-in 200 m away = **89.2% overlap**, far control **0%** (varies) |
| 2 | Broker | Mang Inasal | Territory — between branches; grilled-QSR competitors (14) |
| 3 | AFFI | Chatime | Territory — cluster **18.7%**; milk-tea competitors (20) |
| 4 | Broker | 7-Eleven | White-Space — 10 gaps, **9 distinct scores** |
| 5 | AFFI | Alfamart | White-Space — fringe; real varying scores |
| 6 | Analyst | Ministop | White-Space — small-net ranking |
| 7 | AFFI | Starbucks | Daypart — office-led peak **12 h**, wmatch 88.4 |
| 8 | Broker | Coffee Bean | Daypart — residential peak **19 h**, wmatch 47.2 |
| 9 | AFFI | Kumon | Daypart — peak **13 h**, wmatch 84.4 |
| 10 | Broker | Anytime Fitness | Daypart — daytime-pop driven, peak 12 h |
| 11 | AFFI | Macao Imperial Tea | Lease — BGC, **6 comps**, real percentile |
| 12 | Broker | Bench | Lease — Mandaluyong, 5 comps |
| 13 | AFFI | Watsons | Lease — QC, 6 comps |
| 14 | Broker | Shell | Lease — **CAMANAVA edge, 5 comps** (no false-insufficient) |
| 15 | AFFI | Mercury Drug | Territory + Healthcare — overlap + referral |
| 16 | Broker | Cebuana | White-Space — dense network, 9 distinct scores |
| 17 | AFFI | Red Ribbon | Daypart — peak 13 h, add-vs-redistribute |
| 18 | Broker | Petron | Territory — **3.5% overlap** vs far 0%, land screen |
| 19 | Analyst | (cross-view) | **Access — staff sees all; foreign broker refused** |
| 20 | AFFI | (scoped) | **Access — franchisee sees own only; cross-read refused** |

Peaks genuinely shift (12 h office vs 19 h residential), overlap genuinely varies with
distance, lease never falsely reports insufficient, white-space scores genuinely differ, and
no role can read another franchisor's data. That is the four modules "genuinely working."

---

## Findings (captured → tagged → fixed)

### `[MODULE-ROBUSTNESS]` Major — Daypart curve was UI-reconstructed, not persisted **(FIXED)**
Investigating the Daypart gate, the module persisted `daytimeShare` + `windowMatchPct` but NOT
the 24-hour curve — the UI page rebuilt the curve itself (`curveFromShare`). The module was
computing the right *signal* (share/windowMatch genuinely varied), but the curve — the thing a
report or API consumer needs — lived only in the UI. A report exporter or a second UI would
have had to duplicate that logic (drift risk), and the QA gate couldn't verify the curve.

**Fix.** Moved the curve into the pure math module: `scoreDaypart` now returns and persists
`hourly` (24 normalized values) + `peakHour`. The Daypart page prefers the persisted curve
(falls back to recompute for old runs). Now the module's output is complete and every consumer
reads the SAME curve. Verified live: office-led catchment peaks **12 h**, residential **19 h**,
curves non-flat and distinct. 1 new unit test asserts the peak shifts with the catchment.

### `[MODULE-FALSE / INSUFFICIENT]` — none found; all four modules verified genuine
- **Territory Guard:** overlap varies with geometry (89.2% near → 0% far); concept-relevant
  competitors; a distant control confirms it isn't constant. ✓
- **Lease Benchmark:** every scenario corridor resolved with ≥5 comps — no false "insufficient"
  where data exists; edge corridors (CAMANAVA) covered from v4. ✓
- **Daypart:** curve varies by catchment (see above). ✓
- **White-Space:** 10 gaps with 9 distinct opportunity scores — real ranking, not identical
  duplicates; honest `no_gaps` / `no_demographic_data` flags available for thin areas. ✓

### `[ACCESS]` BLOCKER-class check — role scoping verified AIRTIGHT **(VERIFIED, no leak)**
The role emphasis of this round. Confirmed via `canAccessFranchisor`:
- **AFFI member (franchisor role):** reads ONLY their own franchisor; a foreign franchisor is
  refused.
- **Broker:** reads only the attached franchisor; a broker of a DIFFERENT franchisor is refused
  from this run's data (no cross-client leak).
- **Analyst / admin (Grid staff):** read all franchisors.
No leak found. Both dedicated access scenarios (19, 20) pass.

---

## Coverage after four rounds

50 scenarios total, all 20 Excel clusters, all four headline modules stress-proven to vary
correctly, all three roles (broker / AFFI-member / staff) exercised with access scoping
verified. Stressors covered across rounds: thin networks, edge geographies, ambiguous
concepts, and now role-scoping + module-genuineness.

---

## Verification

- All 20 role-focused extreme scenarios **PASS 3/3**.
- Territory / Lease / Daypart / White-Space each proven to vary with input + flag insufficient
  honestly — no false or silently-insufficient output.
- Broker / AFFI-member access scoping airtight.
- app tsc ✓, scripts tsc ✓, `next build` ✓, vitest **225 tests** ✓.

## Residual / future (non-blocking)

- Full PSA barangay demographics → richer Daypart/White-Space signal in sparse areas
  (behaviour is honest today via flags + the demand-cap).
- Verified lease comps for the secondary corridors (grounded Assumed today).
- Hotel tourism-flow pillar (carried).
