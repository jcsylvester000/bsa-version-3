# Claude Design Prompt — BSA (Business Site Analysis) by GRID Property Ventures

You are a senior product designer redesigning **BSA — Business Site Analysis**, a web app by GRID Property Ventures (Philippines). Produce a cohesive, development-ready UI design that a Next.js + Tailwind team can implement directly.

## What the product does
BSA helps Filipino real estate brokers and agents evaluate candidate commercial sites for franchise brands. A broker enters a brand and up to 5 candidate sites; the app runs four deterministic analysis modules per site and rolls them into a single **Proceed / Proceed with caution / No-Go** recommendation. BSA supports the broker — it never replaces them, and it never issues price verdicts.

## Who uses it
- Real estate brokers and agents (primary) — busy, often on laptops in the field, sometimes on phones.
- Franchise owners and analysts reviewing results.
- Many users are **not tech-savvy** (including older users). Clarity beats cleverness: large readable type, obvious primary actions, plain language, no jargon without explanation.

## Screens to design (current information architecture)
1. **Login / Create account** — logo, sign-in and create-account tabs.
2. **App shell** — left sidebar with the GRID logo, "Business Site Analysis" label, nav: Franchise Screening · Site Dashboard · New Intake; account/role/settings/logout at the bottom. Mobile: top bar + drawer.
3. **Franchise Screening** — browse/filter franchise brands with requirements (investment range, space, category); paginated list/cards.
4. **New Intake** — a 4-step wizard (brand & concept → site preferences → candidate sites with a map location picker, up to 5 → review & submit). Show progress, validation, and a clear "what happens next".
5. **Site Dashboard** — list of runs, then a run view: ranked site shortlist with composite score, verdict, and status; re-run analysis; version history; run report.
6. **Site detail** — per-site page with 5 tabs:
   - **Territory Guard** — map of own outlets + competitors, cannibalization and saturation figures.
   - **Lease Benchmark** — corridor rent distribution chart, the site's asking-rent position (below / in line / above the corridor), BIR zonal value shown only as a tax-reference floor; input to save an asking rent.
   - **Daypart Demand** — demand curve across the day, window-match %, seasonality notes.
   - **White-Space** — map of nearby barangays with open / workable / contested opportunity.
   - **Final Report** — the headline recommendation badge (Proceed / Proceed with caution / No-Go), a one-line rationale, findings list (keyword: data), keyword tags, and the four module summaries below; **Export site PDF** button.
7. **Settings** — account details.
8. **Empty, loading, and error states** for all of the above (including "not enough data yet" — the app shows honest gaps, never fake zeros).

## Brand system (must follow)
**Colors — primary:** Nile Blue `#1C335E`, Muesli `#BE8562`, White `#FFFFFF`, Midnight `#0E192F`.
**Colors — secondary:** Deep Code `#141545`, Burly Wood `#E2B985`, Iron `#D2D2D2`, Black `#000000`.
**Typography:** headings **Cantata One**, body **Poppins**, secondary/serif accent **Judson**.
**Logo:** three wave ribbons (earth, water, wind) + "GRID / PROPERTY VENTURES". A dark-theme version (tan waves, light wordmark) exists for navy backgrounds. Respect clear space; don't recolor the waves.
**Voice:** professional yet approachable, clear and concise, confident and supportive, inclusive, no heavy jargon.

The current app is a dark navy theme (Midnight page, Nile Blue cards, Muesli accent). You may propose refining it, and optionally a light theme — but both must stay on-brand.

## Functional color semantics (keep distinct from brand accents)
- Verdicts: Proceed (green), Proceed with caution (amber), No-Go (red). Must be readable by color-blind users — pair color with label/icon.
- **Truth Layer** chips on every figure: **Verified** (green), **Assumed** (amber), **Projected** (violet). This is core to trust — design a clear, consistent, unobtrusive chip system and a legend.
- Muesli (the brand accent) is for CTAs and highlights; don't let it be confused with the amber "caution" status.

## Non-negotiable content rules
- No price verdicts. Lease is always described as *position vs the corridor* (below / in line / above), never "good deal" / "overpriced".
- BIR zonal values are labeled as a **tax-reference floor**, not market price.
- A broker-supplementation / **RA 9646** notice appears on every signed-in page (footer) and in exports — design it to be present but calm.
- Every number shown traces to data and carries its Truth Layer.

## What I want from you
1. **Design principles** (5–7) tailored to this audience and product.
2. **Design system spec**: color tokens (semantic names → hex, dark and optional light), type scale (sizes, weights, line heights for Cantata One / Poppins / Judson), spacing scale, radii, elevation, iconography guidance, and component states (default / hover / focus / disabled / error).
3. **Component library**: buttons, inputs, select, tabs, stepper, cards, stat tiles, verdict badge, Truth Layer chip + legend, data table, chart styling (distribution, curve), map markers/legend/popups, empty/loading/error states, toasts, modal.
4. **Screen designs** for every screen listed above (desktop first, then mobile), shown as high-fidelity mockups. Prioritize the **Final Report** tab and the **Site Dashboard** — they must make the Proceed / Caution / No-Go call obvious in under 5 seconds.
5. **Accessibility**: WCAG 2.2 AA contrast on all text and chips (check Muesli-on-navy and white-on-Muesli), visible focus, keyboard flow, min 16px body, 44px touch targets.
6. **Implementation handoff**: express tokens as a `tailwind.config.ts` `theme.extend` block (colors, fontFamily, fontSize, borderRadius, boxShadow) and component classes as Tailwind utility recipes, so developers can drop them into the existing codebase. Flag anything that needs a new dependency.

## Constraints
- Stack is fixed: Next.js (App Router) + React + TypeScript + Tailwind. Maps use MapLibre; charts are custom SVG. Don't propose a different framework or UI kit.
- Keep the existing information architecture and features; improve hierarchy, clarity, and polish rather than inventing new features. Suggest IA improvements separately, clearly marked as optional.
- Design for Filipino market context (₱ currency, Philippine place names like barangay / city / corridor, Manila time).

Start with the design principles and design-system tokens, then show the Final Report and Site Dashboard screens, then the rest.
