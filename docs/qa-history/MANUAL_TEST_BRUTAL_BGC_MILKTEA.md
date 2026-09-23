# BRUTAL Manual Test — Chatime BGC Aggressive Expansion (with self-cannibalization + thin-edge trap)

**For:** Joseph Sylvester · run this by hand through the live app UI.
**Why brutal:** one intake stresses FIVE things at once, and two of them are *traps* the app must
handle honestly — a self-cannibalization overlap between two of your own branches, and a
thin-data edge site that a naïve app would over-score. Every expected result below is something
you can independently sanity-check against what you know about BGC and Navotas.

Run it, then compare what the app shows against the **"What the app SHOULD say"** column. If it
says something different, that's a finding — note it and send it back.

---

## Setup

- **Log in as:** a **franchisor** or **broker** role (this is a franchisee expanding their own
  network). If you have a Chatime franchisor already, use it; otherwise create/select any
  milk-tea franchisor.
- **Vertical:** Coffee shop / Café  *(milk tea lives under the café vertical — the concept
  discriminator sub-routes on the brand/concept text you type, so the wording below matters)*

---

## STEP 1 — Business vertical

| Field | Value |
|---|---|
| Exact vertical | **Coffee shop / Café** |
| Franchisor | your Chatime / milk-tea brand |

---

## STEP 2 — Brand & requirements

Type these **exactly** — the words "milk tea" / "pearl" are what tell the engine to pull tea
shops, not coffee shops.

| Field | Value |
|---|---|
| Brand & concept | **Affordable premium milk tea — pearl / bubble tea, grab-and-go** |
| Target customer | **Young professionals & students (18–34)** |
| Catchment income band | **B–C (middle)** |
| Format & footprint | **Under 40 sqm (kiosk / small)** |
| Unit economics | **Avg ticket ₱140** |
| Expansion goals | **10+ branches (aggressive)** |
| Site preferences | **High-footfall corridors (offices / transit)** |
| Governance & consent | **Yes — I consent…** |

*(No land / mall / units fields should appear — this is a café vertical. If they do appear,
that's a finding.)*

---

## STEP 3 — Existing outlets  ← this is the cannibalization trap

Add **ONE existing branch**, and pin it in **BGC**:

| Field | Value |
|---|---|
| Branch name | **Chatime BGC High Street** |
| Format | Inline (street-level unit) |
| Address (auto-locate) | **BGC High Street, Taguig** (or pin manually) |
| Pin (📍) | **lat 14.5507, lon 121.0487** |
| Sales ₱ | **850000** |

> This branch already exists. In Step 4 you'll add a NEW candidate ~250 m away — the app must
> flag that the new site **cannibalizes** this one.

---

## STEP 4 — Candidate sites

Add **TWO candidates**:

**Candidate A — the cannibalization case (BGC, ~250 m from the existing branch):**

| Field | Value |
|---|---|
| Label | **Chatime — BGC 7th Ave** |
| Address | **7th Avenue, BGC, Taguig** |
| Pin (📍) | **lat 14.5507, lon 121.0510** |
| Site type | inline |

**Candidate B — the thin-edge trap (Navotas, sparse data):**

| Field | Value |
|---|---|
| Label | **Chatime — Navotas M. Naval** |
| Address | **M. Naval St, Navotas** |
| Pin (📍) | **lat 14.6569, lon 120.9478** |
| Site type | inline |

Submit the run.

---

## What the app SHOULD say  (verify each — this is the scorecard)

### Territory Guard
- **Candidate A (BGC 7th Ave):** should show a **HIGH overlap** with your existing BGC High
  Street branch — the two are only ~250 m apart, so their trade areas heavily overlap. Expect a
  **cannibalization / caution flag**, NOT a clean "go." *You know BGC High St and 7th Ave are
  basically the same catchment — the app must agree.*
- **Candidate B (Navotas):** overlap with your BGC branch should be **~0%** (they're ~20 km
  apart). If it shows any overlap, that's wrong.
- **Competitors pulled** must be **milk-tea shops** (Chatime, Macao Imperial, Gong Cha, CoCo,
  Serenitea, etc.) — **NOT** Starbucks / coffee / burger joints. BGC has ~108 F&B competitors in
  800 m but only ~4 are milk-tea; the app should surface tea, not the whole F&B crowd. *This is
  the core discrimination test — eyeball the competitor names.*

### Daypart & Seasonality
- **Candidate A (BGC):** BGC is office-led (≈445k daytime vs ≈194k residents in catchment), so
  the curve should **peak around midday (11h–14h)**, and the read should say **office-led /
  midday**. A grab-and-go tea kiosk *fits* that — expect a reasonable window match.
- If the app shows BGC peaking in the **evening (19h)**, that's wrong — you know BGC empties out
  after office hours.

### Lease Benchmark
- **Candidate A (BGC):** should return **real BGC comps** in roughly the **₱2,200–₱4,500 / sqm /
  month** band (BGC is the priciest corridor). ≥5 comps. *If it says "insufficient data" for BGC,
  that's a bug — BGC is the best-covered corridor.*
- **Candidate B (Navotas):** resolves to the **CAMANAVA** corridor with real comps (≈5). Rents
  should be **much lower** than BGC. It should NOT falsely say insufficient.

### Site Fit (the honesty trap)
- **Candidate A (BGC):** strong catchment + demand data present → a **real composite score** with
  a **Verified/Assumed** truth chip.
- **Candidate B (Navotas):** competitor data is **thin (≈0 within 800 m)**. The app must **NOT**
  hand you a confident high "Go" off one lone pillar. Expect either a **capped / lower-confidence
  score**, a **"low confidence / insufficient data" flag**, or an honest **Assumed** downgrade.
  *This is the falsely-confident-score trap — a naïve app scores Navotas 90+/Go off thin data;
  the correct app flags the thinness.*

### Truth Layer (spot-check across every module)
- Nothing invented should be labelled **Verified**. Real coordinates & real comps = Verified;
  projected sales / estimated demand = **Assumed / Projected** and labelled as such. If you see a
  made-up-looking number wearing a green "Verified" chip, that's a finding.

### Access (if you can)
- If you have a **second, different franchisor** login, confirm it **cannot** open this run's
  report (no cross-client leak). Your own login sees it; a foreign one is refused.

---

## Scorecard — fill this in as you go

| Check | Pass? | What the app actually showed |
|---|---|---|
| A: Territory flags BGC self-cannibalization (high overlap) | ☐ | |
| B: Territory shows ~0% overlap for Navotas | ☐ | |
| Competitors pulled are milk-tea, not coffee/burgers | ☐ | |
| Daypart reads BGC as office-led, midday peak | ☐ | |
| Lease returns real BGC comps (~₱2.2k–4.5k), ≥5 | ☐ | |
| Lease resolves Navotas (CAMANAVA), not "insufficient" | ☐ | |
| BGC site-fit = real score, honest truth chip | ☐ | |
| Navotas site-fit is NOT a confident high "Go" (thin-data flagged) | ☐ | |
| No invented number wears a "Verified" chip | ☐ | |
| (Optional) foreign franchisor can't read the run | ☐ | |

Anything that fails → send me the row + what you saw, and I'll root-cause it.
