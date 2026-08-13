# BRUTAL Manual Test — Mercury Drug NCR (data-verifiable: España vs Commonwealth)

**For:** Joseph Sylvester · run by hand through the live app UI.
**Why this one:** every expected number below is a **real value stored in the database**, so you
can confirm the app is reporting the *actual* data — not inventing it. Two real NCR pharmacy
sites that the app **must treat differently**: one dense and well-covered, one a high-population
site with genuinely thin support data (the trap).

Run against the populated DB (if you spun up a fresh DB, run `npm run db:populate` first).

---

## The two sites and their ACTUAL stored data (this is your answer key)

| | **Site A — Manila España** | **Site B — QC Commonwealth** |
|---|---|---|
| Pin (lat, lon) | **14.6091, 120.9899** | **14.7010, 121.0870** |
| Barangay (in DB) | Sampaloc (España corridor) | Commonwealth |
| Population (stored) | **385,000** | **213,229** |
| Daytime pop (stored) | **420,000** | **190,000** |
| Income band (stored) | **CD** | **CD** |
| Hospitals/clinics within 2 km | **38** (nearest ≈ **186 m**) | **0** (nearest ≈ **3,808 m**) |
| Competitors within 800 m | **61** | **0** |
| Lease corridor it resolves to | **Manila** (5 comps, ₱1,000–2,200) | **Quezon City** (6 comps, ₱1,000–2,600) |

> These are the exact figures in the database. When the app shows a number, check it against this
> table. If a shown value doesn't match — or if the app presents a made-up value as **Verified** —
> that's a finding.

---

## Setup

- **Log in as:** a **franchisor** (Mercury Drug / any pharmacy brand) or **broker**.
- **Vertical:** **Pharmacy / Health retail**
- *(Pharmacy runs Site Fit, Territory, Lease, and the Healthcare-proximity module — that
  healthcare read is the star of this test.)*

---

## STEP 1 — Business vertical

| Field | Value |
|---|---|
| Exact vertical | **Pharmacy / Health retail** |
| Franchisor | Mercury Drug (or your pharmacy brand) |

## STEP 2 — Brand & requirements

| Field | Value |
|---|---|
| Brand & concept | **Community pharmacy — near clinics & hospitals** |
| Target customer | **Families & residential households** |
| Catchment income band | **C–D (mass)** |
| Format & footprint | **40–80 sqm (standard inline)** |
| Unit economics | **Avg ticket ₱280** |
| Expansion goals | **10+ branches (aggressive)** |
| Site preferences | **Near clinics / hospitals** |
| Governance & consent | **Yes — I consent…** |

## STEP 3 — Existing outlets

Skip (no existing branches needed for this test) — or add none.

## STEP 4 — Candidate sites

Add **both** candidates:

**Site A — Manila España:**

| Field | Value |
|---|---|
| Label | **Mercury — Manila España** |
| Address | **España Blvd, Sampaloc, Manila** |
| Pin (📍) | **lat 14.6091, lon 120.9899** |
| Site type | inline |

**Site B — QC Commonwealth:**

| Field | Value |
|---|---|
| Label | **Mercury — QC Commonwealth** |
| Address | **Commonwealth Ave, Quezon City** |
| Pin (📍) | **lat 14.7010, lon 121.0870** |
| Site type | inline |

Submit the run.

---

## What the app SHOULD say (check each against the answer-key table)

### Healthcare Proximity module  ← the headline check
- **Site A (España):** should read **STRONG** — nearest facility ≈ **186 m**, **38** facilities
  within 2 km. That's a dense medical cluster; a pharmacy wants exactly this. Expect a high
  proximity score.
- **Site B (Commonwealth):** should read **WEAK / no_data-ish** — nearest hospital ≈ **3.8 km**,
  **0** within 2 km. The app must say the healthcare support is thin here — NOT invent nearby
  clinics. *If Commonwealth shows a strong healthcare read, the app is lying about the data.*

### Territory / Site Fit competitor count
- **Site A:** ~**61** competitors within 800 m — a real, dense pharmacy market.
- **Site B:** ~**0** competitors within 800 m. This is the trap: Commonwealth has **213k
  residents** (real demand) but almost no competitor data. The app must **NOT** hand you a
  confident high "Go" off the population pillar alone — expect a **low-confidence / thin-data
  flag** or a **capped score** with an **Assumed** (not Verified) truth chip. *You know
  Commonwealth is a massive barangay — the app agreeing it has demand is fine; the app pretending
  it has verified competitive + healthcare data is the failure.*

### Demographics shown
- Whatever population / daytime / income the app displays for each site should match the
  answer-key table (**385k / 420k / CD** for España; **213,229 / 190,000 / CD** for Commonwealth).
  Small rounding is fine; a wildly different number is a finding.

### Lease Benchmark
- **Site A (España):** resolves to the **Manila** corridor, **5 comps**, rents **₱1,000–2,200**.
- **Site B (Commonwealth):** resolves to the **Quezon City** corridor, **6 comps**, rents
  **₱1,000–2,600**.
- Neither should say "insufficient data" — both corridors have comps. If either does, that's a bug.

### Truth Layer (spot-check every module)
- Real coordinates, real comps, real facility distances = **Verified**.
- Projected sales, estimated demand, the thin-data reads = **Assumed / Projected**, labelled.
- **The key integrity check:** Commonwealth's healthcare and competitor reads are thin — they must
  wear an **honest** truth chip / flag, never a confident **Verified** "all good."

---

## Scorecard

| # | Check | Pass? | What the app actually showed |
|---|---|---|---|
| 1 | España healthcare read = STRONG (nearest ~186 m, 38 within 2 km) | ☐ | |
| 2 | Commonwealth healthcare read = WEAK / thin (nearest ~3.8 km, 0 within 2 km) | ☐ | |
| 3 | España competitors ≈ 61 within 800 m | ☐ | |
| 4 | Commonwealth competitors ≈ 0 within 800 m | ☐ | |
| 5 | Commonwealth is NOT a confident high "Go" (thin data flagged) | ☐ | |
| 6 | Population shown matches DB (385k España / 213,229 Commonwealth) | ☐ | |
| 7 | España lease = Manila corridor, 5 comps, ₱1k–2.2k | ☐ | |
| 8 | Commonwealth lease = QC corridor, 6 comps, ₱1k–2.6k | ☐ | |
| 9 | Thin reads wear honest truth chips (not Verified) | ☐ | |
| 10 | (Optional) a different franchisor login can't open this run | ☐ | |

Any row that fails → send me the row number + what you saw, and I'll root-cause it.

---

### Quick way to double-check the answer key yourself (optional)
If you want to confirm these numbers straight from the database, the values above come from the
`demographic_cell`, `poi`, and `lease_comp` tables — e.g. Commonwealth's `population = 213229`,
and `0` competitor POIs within 800 m of `(14.7010, 121.0870)`. The app should surface the same.
