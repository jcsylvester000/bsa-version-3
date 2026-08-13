# BSA — User Journey QA v5: Game Plan (Round 4 — 20 EXTREME scenarios, role-focused)

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-05
**Status:** DRAFT — awaiting approval before execution.

**Mission:** 20 new, extremely hard scenarios centred on the people who actually use BSL —
**brokers, agents, and AFFI members (franchisees) looking to expand.** The bar: prove that
**Territory Guard, Lease Benchmark, Daypart Demand, and White-Space** genuinely work — real,
correct, honestly-labelled output — and never silently emit **false** or **insufficient** data
dressed up as a real result. Each scenario must pass **3/3 gates** before the next.

---

## The user emphasis: brokers, agents, AFFI members

BSL's core users aren't just franchisor HQ. This round makes them first-class:

| Role in system | Real-world user | What they do in BSL | Access scope |
|---|---|---|---|
| `broker` | Broker / agent | Runs analysis *for* a franchisee client; supplements the deal | Only the attached franchisor's data |
| `franchisor` (scoped) | **AFFI member / franchisee** expanding | Self-serve site check on a walk-in / target site | Only their own franchisor's data |
| `analyst` / `admin` | Grid staff | Cross-franchisor view, all runs, data quality | All data |

**Access-scoping is now a gate.** Several scenarios verify a broker/AFFI-member can ONLY see
their own franchisor's outlets and runs — and a cross-franchisor read is refused. A leak here
is a Blocker.

---

## The 4 modules must "genuinely work" — what that means (the hard bar)

For each module I define pass/fail so the gate catches false OR insufficient output:

### Territory Guard
- **Works:** overlap % is computed from real coordinates and VARIES with distance (a candidate
  near an outlet reads high overlap; far reads low/zero). Verdict follows overlap. Competitors
  are concept-relevant.
- **FALSE/INSUFFICIENT (fail):** overlap constant regardless of geometry; verdict with no
  measurement; competitors from the wrong concept; a 0-outlet brand producing a confident
  cannibalization number.

### Lease Benchmark
- **Works:** resolves a corridor with ≥ MIN_SAMPLE comps, returns a percentile + negotiating
  room, `lowSample` honestly set when the sample is thin.
- **FALSE/INSUFFICIENT (fail):** returns `insufficient_data` where comps DO exist (corridor
  mis-mapped); OR returns a confident percentile off < MIN_SAMPLE comps without the low-sample
  flag; OR invents a rate.

### Daypart Demand
- **Works:** the 24-h curve is built from real `daytime_pop` vs `residential` split and the
  peak window + windowMatch VARY by catchment (office-led vs residential differ). Projected,
  labelled.
- **FALSE/INSUFFICIENT (fail):** a flat/constant curve; windowMatch identical across very
  different catchments; OR silently 0 when `daytime_pop` is missing (must flag
  `no_demographic_data`, not fake a curve).

### White-Space
- **Works:** ranks real under-served cells (demand-minus-supply) with varying opportunity
  scores; flags `no_demographic_data` / `no_gaps` honestly when the layer is thin.
- **FALSE/INSUFFICIENT (fail):** returns gaps with identical scores; OR ranks gaps in an area
  with no demographic data as if real; OR empty with no honest flag.

---

## The 20 scenarios (role × module-stress × geography)

Balanced so each of the 4 modules is stress-tested multiple times, across roles and hard
geographies. Brands drawn from the catalog (mixing reused-but-harder-context and fresh angles;
the *scenario* — role + candidate + stress — is what's unique).

| # | Role | Brand / vertical | Module under hardest test | Hard because |
|---|---|---|---|---|
| 1 | AFFI member | Jollibee QSR | Territory Guard | walk-in site 200 m from own branch (extreme overlap) |
| 2 | Broker | Mang Inasal (grilled) | Territory Guard | client site between 2 branches (mixed) |
| 3 | AFFI member | Chatime milk tea | Territory Guard | dense cluster — cannibalization vs concept competitors |
| 4 | Broker | 7-Eleven convenience | White-Space | network gap ranking across a region |
| 5 | AFFI member | Alfamart grocery | White-Space | thin-demographic fringe — honest `no_gaps`? |
| 6 | Analyst | Ministop (8 outlets) | White-Space | small network white-space at scale |
| 7 | AFFI member | Starbucks cafe | Daypart | CBD office-led vs BGC — curves must differ |
| 8 | Broker | The Coffee Bean cafe | Daypart | residential catchment — evening peak |
| 9 | AFFI member | Kumon education | Daypart | school-proximity daypart (term-time) |
| 10 | Broker | Anytime Fitness | Daypart | daytime working-pop dependent |
| 11 | AFFI member | Macao Imperial Tea | Lease | BGC — above/below median with real comps |
| 12 | Broker | Bench apparel | Lease | mall corridor lease |
| 13 | AFFI member | Watsons pharmacy | Lease | QC corridor — percentile + room |
| 14 | Broker | Shell fuel | Lease | edge corridor (CAMANAVA) — low sample honesty |
| 15 | AFFI member | Mercury Drug pharmacy | Territory + Healthcare | referral proximity + overlap |
| 16 | Broker | Cebuana remittance | White-Space + Territory | dense network, footfall nodes |
| 17 | AFFI member | Red Ribbon bakery | Territory + Daypart | neighbourhood add-vs-redistribute |
| 18 | Broker | Petron fuel | Land + Territory | land screen + own-network |
| 19 | Analyst | cross-franchisor | Access scoping | staff sees all; verify broker CANNOT |
| 20 | AFFI member | (scoped) | Access scoping | franchisee sees ONLY own data; cross-read refused |

Scenarios 19–20 are pure **access-control** tests — a broker/AFFI member attempting to read
another franchisor's run must be refused (`canAccessFranchisor`), and staff must see all.

---

## The 3 gates (role-aware, module-strict)

- **Gate A — Data sufficiency / honesty.** As before, PLUS: the module under test must have
  the data it needs OR honestly flag insufficient (never a confident number on missing data).
- **Gate B — Module genuinely works.** The specific module for the scenario passes its
  "works vs false/insufficient" definition above — verified by asserting the output VARIES with
  input and carries the right honesty flags. This is the heart of this round.
- **Gate C — Role & integrity.** The right role scoping holds (broker/AFFI see only their data;
  a cross-franchisor read is refused; staff see all); modules fire; verdicts + Truth Layers
  present; a user in that role could complete the journey.

A scenario passes only 3/3. Any module emitting false or unflagged-insufficient data is a
Blocker fixed before advancing.

---

## What this round will specifically hunt (pre-tagged)

- `[MODULE-FALSE]` — a module returning a constant/duplicate output regardless of input
  (Daypart flat curve; White-Space identical scores; Territory constant overlap).
- `[MODULE-INSUFFICIENT]` — a module returning "insufficient" where data exists (corridor
  mis-map), or a confident result where it should flag thin.
- `[ACCESS-LEAK]` — a broker/AFFI member able to read another franchisor's data. Blocker.
- `[DATA-GAP]` — Daypart/White-Space thin where `daytime_pop`/demographics are sparse → fill
  real data or confirm honest flagging.
- `[UX-IMPROVE]` — the module result doesn't clearly communicate low-confidence to a
  broker/AFFI user.

Fixes follow the established mechanisms (concept taxonomy, corridor mapping, honest-degradation
cap, data ingest, access helpers).

---

## Execution order

1. Build a **role-aware QA harness** that runs each scenario as the stated role (broker /
   AFFI-member / analyst), asserts the module-genuinely-works checks, and tests access scoping.
2. Scenario 1 → gates A/B/C, fix root causes until 3/3. Then 2–20, each 3/3 before advancing.
3. Where Daypart/White-Space are thin, ingest real `daytime_pop`/demographic data (or confirm
   honest flagging). Where access scoping leaks, fix the helper.
4. Final pass — full test suite + build green; tagged findings in
   `docs/QA_JOURNEY_FINDINGS_V5.md`; deliver files + data + `db:populate` commands.

---

## What "done" looks like

- 20 role-focused extreme scenarios, 10/10… **20/20 pass 3/3.**
- Territory Guard, Lease, Daypart, White-Space each PROVEN to vary correctly with input and to
  flag insufficient data honestly — no false or silently-insufficient output.
- Broker / AFFI-member access scoping verified airtight.
- Any gap filled with real data; any false/insufficient path fixed.
- `QA_JOURNEY_FINDINGS_V5.md` tags every issue + fix.

---

## Approval

Approve to begin, or adjust (role mix, which modules to stress hardest, specific brands, how
aggressively to expand data). On approval I build the role-aware harness and run Scenario 1
through its 3 gates.
