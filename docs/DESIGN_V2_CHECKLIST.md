# BSA Design v2 — Implementation Checklist

Source: `2 -  Data Intake/BSA Design System Overview/implementation/` (Claude Design bundle — `README.md`,
`PATCHES.md`, drop-in files, `design-reference/*.dc.html` mockups). Reference folder is read-only; every
change lands in `4 - Final Application`.

Decisions (owner, 2026-09-25): **theme-ready, dark only** (light tokens + dual logo installed, no Settings
toggle yet) · **one GitHub push per batch**.

Legend: `[x]` done in code · `[ ]` open · `[~]` done with a deliberate deviation (see note) · `[-]` deferred.

---

## Batch 0 — Pending audit fixes (already committed by the owner as `0ecddcd`)
Were uncommitted when this work started: F-32 mobile nav, F-49 migrate-on-deploy, F-50 build id, F-04 run
`maxDuration`, onboarding tour copy, CI workflow. The owner committed them mid-session (`0ecddcd`), so
Batch 0 needs no further commit.

- [x] `app/api/runs/[id]/run/route.ts` (maxDuration 26s) · `netlify.toml` · `next.config.mjs` (build id)
- [x] `components/OnboardingTour.tsx` copy · `.github/workflows/ci.yml`
- [x] (`layout.tsx` + `MobileNav.tsx` are superseded by Batch 2 and committed there)

## Batch 1 — Foundation: tokens, global CSS, UI primitives (README §1, order step 1–2)
- [x] `tailwind.config.ts` — colours through CSS variables; `border-strong`, `accent-text/on/hover`,
      `on-status`, `focus`; type scale; radii; shadows; `min-h-tap`; `darkMode` keyed on `data-theme`
- [x] `app/globals.css` — dark + light variables, AA status colours, component recipes, map-marker classes,
      themed MapLibre popups/controls; AnalysisSequence animations + autofill guard kept
- [x] `components/ui/Chips.tsx` — TruthChip (glyph + word, `compact`), TruthLegend, VerdictPill (icon +
      word, `null` → "— Not enough data"), StatusText, NewTag
- [x] `components/TruthChip.tsx` → re-export (single implementation)
- [x] `components/ui/StatTile.tsx` — `truth` prop, honest-gap state for null
- [x] `components/ui/Panel.tsx` — restyle + `TruthMixBar`
- [x] PATCHES §5 `components/GridLogo.tsx` — dark/light logo pair
- [x] `app/layout.tsx` — `<html data-theme="dark">` default

## Batch 2 — App shell + Site Dashboard (README §1, order step 2–3)
- [~] `app/(app)/layout.tsx` — 248px sticky rail, skip link, MobileNav, calm RA 9646 footer.
      **Deviation:** keeps the build id (audit F-50) in the footer, which the bundle file dropped.
- [x] `components/SidebarNav.tsx` — 44px items, `aria-current`, `/site` highlights Site Dashboard, `onNavigate`
- [x] `components/LogoutButton.tsx` — 44px target, "Log out", optional `className`
- [x] `components/MobileNav.tsx` — top bar + native `<dialog>` drawer (replaces the F-32 drawer)
- [~] `components/RunDashboard.tsx` — verdict strip first, 76px shortlist rows → `&tab=analysis`, right rail.
      **Deviation (guardrail):** "Rent above median" tile uses a neutral colour, not amber/green —
      same rule as PATCHES §1h (rent colour must not read as good/bad).

## Batch 3 — Per-site page + Final Report (PATCHES §1, README §4)
- [x] `components/FinalReport.tsx` — `FinalReportHero`, `FindingsList`
- [x] 1a imports
- [x] 1b last tab label → "Final Report" (key stays `analysis`); `initialTab` prop; `site/page.tsx` reads
      `searchParams.tab` (validated against the tab keys, not `as any`)
- [x] 1c underline tabs, roving tabindex, ← → keys with focus move, `TruthLegend` once in the header
- [x] 1d `Chip` → `StatusText` (icon + word)
- [x] 1e `Stat` → stat tile with `truth` chip; "(Projected)/(Assumed)/(Verified)" parentheticals → `truth` prop
- [x] 1f `ReportRow` → compact chip, 48px rows, `text-body`
- [x] 1g `AnalysisTab` → hero + findings; module summaries in a 2-column grid with `h2`; "Open … ›" links
- [x] 1g Export site PDF (`btn-primary btn-lg`) + ↻ Re-run analysis (`btn-secondary btn-lg`) in the site header
      (`RunPipelineButton` now takes `className`)
- [~] 1g hero `limited` state: shown only when the site has no composite band, so the hero never
      contradicts the dashboard (audit F-07); thin data is noted under the rationale instead
- [x] README §4 state: hero gets `composite`, `rank`/`total`, `confidence` (run), `analysedAt` (Manila,
      ICU-free `manilaShortStampYear`), `truthPct` from this site's module Truth Layers
- [x] 1h Lease tab: "Room to negotiate down…" removed; one neutral line; percentile + vs-median colours
      neutral; `L_VERDICT` tones all `muted`
- [~] 1h extra: "Negotiating room to median" relabelled "Distance from corridor median"; the lease chart's
      asking bar is one neutral colour instead of green/red (same guardrail)
- [x] 1i `ContextualNote` / `RerunNote` restyle

## Batch 4 — Login, intake wizard, maps (PATCHES §2–4)
- [x] §2 login: two-column layout (C1), headline + Judson lede + `BROKER_DISCLAIMER_SHORT`; tablist tabs;
      `field-label`; `btn-primary btn-lg`; `role="alert"` error state; `field-error` + `aria-invalid` on confirm
- [x] §3 wizard stepper: 4-column progress bar with `✓ Step n` / `Step n · now`
- [x] §3 `Select` / `SelectOrManual` labels → `field-label` + `mt-1.5`
- [x] §3 step 4: "What happens next" card + "Before you submit" checklist from `computeCompleteness`
- [x] §3 Back / Submit → `btn-secondary btn-lg` + `btn-primary btn-lg flex-[2]`; wizard error → `role="alert"`
- [x] §4 maps: marker classes `.mk-*`, legend overlay, sr-only marker list (Territory, Gaps, LocationPicker)
      via new `components/MapMarkers.tsx`; LocationPicker is a labelled dialog with 44px controls

## Batch 5 — All runs list + run states (mockups B3, H1, H2)
- [x] `/runs` list → table: Run (name, vertical, cities) · Brand · Sites · Result (✓ Proceed / ▲ Caution / ✕ No-Go counts) · Last run
- [x] Search by run/brand/city + brand filter (plain GET form, works without JS); "No runs match" state
- [x] H1 "No runs yet" empty state → Start New Intake / browse Franchise Screening
- [x] H2 in-progress card on the run dashboard (sites analysed n of N, progress bar, **↻ Continue analysis**
      resumes without restarting); failed-run alert. `RunPipelineButton` gains `resume`

## Batch 6 — Franchise Screening (mockups D1, D2)
- [x] Brand table → cards: name, category, Truth chip, investment, space, fee, payback, tier tag, fit, reach line
- [x] "Start intake with this brand" → `/intake?brand=…`; the wizard preselects that brand + vertical
      (matched only against brands the user can see)
- [x] Active-filter chips (each removable) + Clear all; D2 "No brands match" + Clear filters
- [x] Loading skeletons; labels/help → `field-label`/`field-help`; 44px pagination; error → `role="alert"`
- [~] Capital-tier tags are neutral outlines (were green/tan/violet) — a tier is a fact, not a status

## Batch 7 — Site tab content (mockups F1–F4, H3) + Final Report figures
- [x] F1 Territory: "Territory call" header, outlet list rows 44px, chip lists restyled
- [x] F2 Lease: "Position vs <corridor> corridor" header; asking rent "Save & use in score" with the
      not-a-price-opinion help line; distribution header with Truth chip + n; **BIR zonal floor card**
      (tax-reference wording from `ZONAL_FLOOR_NOTE`); comps table uses `table-head`
- [x] H3 Lease "— Not enough data yet · only n comparable leases · need at least 5 (`MIN_SAMPLE`)"
- [x] F3 Daypart: Window match + status word, Catchment mix, Peak window (Manila time, `12 NN`)
- [~] F3 seasonality multipliers now neutral text (were green/red)
- [x] F4 White-Space: rank badge contrast, restyled lists
- [x] `FindingsList` `figures` wired: cannibalization ₱/mo, lease percentile (or corridor median),
      window %, white-space area count — each with its own Truth Layer (was deferred)

## Batch 8 — Settings + error/loading states (mockups G1, H4)
- [x] Settings: Account / Getting started / Change password (help text, alert error, `btn-primary`);
      member-since date is ICU-free (`manilaLongStamp`)
- [-] G1 PRC licence number — no field in the data model; not added (needs a schema decision)
- [-] G1/G2 Appearance switch — light theme deferred (owner: dark only)
- [x] H4 `app/(app)/error.tsx` — generic "We couldn’t load this page" + Try again (no internals leaked)
- [x] `app/(app)/loading.tsx` — skeleton page while server pages stream
- [-] H4 "Site PDF is ready" toast — the PDF opens in a new tab, so there is nothing to confirm

## Batch 9 — Legacy pages check + Run Report (all sites) layout
Check (2026-09-28): **Scorecard, All Modules and Explore Places were already removed** (no routes, no
components, no links). **Reports is the only survivor** — reached from the dashboard's "Run report (all sites)".
- [x] `/reports` header: ← Site Dashboard, brand overline, `text-h1`, one-line purpose; empty/no-access → `empty-state`
- [x] Summary strip: confidence (icon + word + what it means), sections assessed n of 9, Truth Layer mix bar
- [x] "On this page" section index (sticky at xl) + numbered section cards with anchors
- [x] Per-site metric rows: label + compact Truth chip, score bar / range / value, status as icon + word
- [x] Not-assessed sections: honest-gap state ("left blank rather than estimated")
- [x] Demo (mock) report uses the same `ReportBody` renderer (bulleted text sections)
- [x] Download modal: `btn-primary btn-lg`, labelled fields, Esc closes, modal tokens
- [~] Rent metrics are `neutral` (no green/red bar or gradient; lease positions shown as statements);
      composer note "Room to median ₱…" → "₱… above/below the corridor median" (`reportComposer.ts`)
- [x] `package-lock.json` re-synced with `package.json` (`@playwright/test` 1.63 was missing) — CI's
      `npm ci` was failing on it

## Batch 10 — Downloadable full report (print-to-PDF) in v2
- [x] `lib/modules/reportHtml.ts` restyled on the app's **light** tokens + Grid type (Cantata One / Poppins /
      Judson); white, printer-friendly cover with the Grid logo (embedded data URI) and the RA 9646 notice
- [x] Summary strip (confidence icon + word, sections assessed, Truth mix); numbered section cards
- [x] Statuses are icon + word; Truth chips outlined glyph + word; not-assessed = honest gap
- [x] **Rent never coloured good/bad:** `neutral` rent metrics + scorecard "Lease value" line use one neutral
      colour; range track neutral; lease verdicts via `LEASE_POSITION_LABEL`; scorecard band = Proceed /
      Proceed with caution / No-Go / Not enough data (same words as the app)
- [x] **Bug fixed:** the "Download / Print PDF" button used inline `onclick`, which the nonce CSP blocks — it
      silently did nothing. Now wired by a nonce'd script (`x-nonce` from middleware); no nonce → hint only
- [x] `tests/unit/reportHtml.test.ts` (no onclick, nonce wiring, neutral rent, escaping)

## Batch 11 — Lease finding is a statement (broker decision, Skill 07)
- [x] Decision: rent position is a fact the broker explains, not a Proceed/Caution vote (no-price-verdict,
      RA 9646). Lease finding tone = `muted` ("Context"), positional wording ("… the corridor median")
- [x] Lease still counts toward **coverage**, but no longer moves the module-derived call; the composite band
      (which includes the saved-rent lease value score) still decides the call — F-07 unchanged
- [x] Keywords positional: `rent-below-median` / `rent-above-median` / `rent-within-range`
- [x] Dashboard alert for rent above the median → new `info` severity (ⓘ), no "room to negotiate" wording
- [x] FindingsList: muted findings read "Context" (was "No data" — wrong for lease and white-space)
- [x] `siteVerdict.test.ts` +4 cases (muted, coverage, never moves the call, positional keywords)

## Batch 12 — Light theme switch (mockup G1/G2)
- [x] Settings → **Appearance**: Dark / Light / Match device (radio cards, 44px, keyboard)
- [x] `bsa-theme` cookie (validated by `parseTheme`) → `<html data-theme>` rendered server-side: no flash,
      no inline script (CSP-safe). Default stays **dark**
- [x] "Match device": light tokens under `prefers-color-scheme: light`; Tailwind `dark:` variant covers
      `system` on dark devices (logo pair swaps correctly)
- [x] Light-mode fixes: accent buttons `text-accent-on` (was `text-ink-bg`, 2.7:1 in light), verdict icon
      discs `bg-on-status`, toast inverse surface, chart axes/labels on theme tokens
- [x] Maps pick CARTO `light_all` / `dark_all` to match the theme (env override still wins)
- [x] `tests/unit/theme.test.ts`
- [ ] Owner: switch to Light in Settings and walk Dashboard → site → Final Report → Screening → Intake

## Batch 13 — Export site PDF = the Final Report screen, as data
Owner request (2026-09-28): the PDF must contain, organised, everything the Final Report tab shows — as
data, not a screenshot.
- [x] New pure `lib/modules/siteReportModel.ts`: `buildSiteReportModel` (recommendation, figures, finding →
      module, four module summaries with every row + Truth Layer, footnote), `siteReportMeta` (composite,
      rank, confidence, analysed time, truth mix), `payloadsFromRows`. **Both the tab and the PDF render it.**
- [x] `SiteIntelligenceTabs` Final Report tab now renders from the model (no duplicated logic)
- [x] `/api/analysis-report/pdf` uses the same access-scoped `getSiteReport` service as the page (F-47)
- [x] `lib/pdf/AnalysisPdf.tsx` rebuilt: header (logo, brand · city, site, generated time) → recommendation
      hero (call + icon, composite, rank, rationale, confidence, coverage, analysed, Truth mix bar) → What drove
      this call (status icon + word, finding, figure + Truth chip, module) + keywords → page 2: Module summaries
      (2 × 2 cards, status, contextual note, every row with its Truth chip) → footnote; RA 9646 footer + page
      numbers on every page. Light print palette; rent statuses muted
- [x] Real fonts in the PDF: Poppins / Cantata One / Judson + Noto subsets for ₱ ✓ ▲ ✕ ≈ ⇗ ≤ (embedded,
      OFL — `lib/pdf/pdfFonts.ts`, `lib/pdf/FONTS_LICENSE.md`). Previously Helvetica could not draw "₱"
- [~] Projected glyph in the PDF is ⇗ (react-pdf drops ↗ as an emoji); the app keeps ↗
- [x] `tests/unit/siteReportModel.test.ts` (+6, incl. a real PDF render) with a BGC fixture
- [ ] Owner: open a site → **Export site PDF** and compare with the Final Report tab

## Verification (every batch)
- [x] `tsc --noEmit` 0 errors (2026-09-25, cloud sandbox — batches 1–4, and again after 5–8)
- [x] `vitest run` 36 files · 426/426 passing (Prisma-engine "unhandled" notices are sandbox-only)
- [x] `next build` compiles every route
- [ ] Browser check by owner after deploy (all batches live on `df39955`) (keyboard: skip link → rail → tabs ← → → content → footer;
      44px targets; every verdict = icon + word; compare with `design-reference/*.dc.html`)

## Deferred / not in scope

---

## Push log
Update this table on every push (hash = first word of `git log --oneline -1` after the push).
Commands are PowerShell 5-safe (one per line). Run them from `4 - Final Application`, in order.
`:(literal)` stops git reading `[id]` as a wildcard.

| # | Batch | Commit message | Status | Hash |
|---|---|---|---|---|
| 0 | Pending audit fixes | `audit batch 2: CI (F-48), migrate-on-deploy (F-49), build id in footer (F-50), mobile nav (F-32), fix onboarding tour (F-33), pipeline maxDuration (F-04)` | ✅ pushed | `0ecddcd` |
| 1 | Foundation | `design v2 batch 1: theme tokens, global CSS recipes, UI primitives, dual logo` | ✅ pushed | `75fcd15` |
| 2 | Shell + dashboard | `design v2 batch 2: app shell, sidebar, mobile dialog nav, dashboard verdict strip` | ✅ pushed | `60404b1` |
| 3 | Site page + Final Report | `design v2 batch 3: Final Report hero + findings, underline tabs, neutral lease cues` | ✅ pushed | `da9afc5` |
| 4 | Login, intake, maps + logs | `design v2 batch 4: login two-column, intake stepper + submit checklist, map markers + legend` | ✅ pushed | `f82716d` |
| 5 | All runs + run states | `design v2 batch 5: all-runs table with results, search/filter, empty + in-progress states` | ✅ pushed | `1fc780c` |
| 6 | Franchise Screening | `design v2 batch 6: franchise screening cards, filter chips, start intake with brand` | ✅ pushed | `89deb3c` |
| 7 | Site tab content | `design v2 batch 7: lease position + zonal floor card, daypart tiles, findings figures` | ✅ pushed | `12ab500` |
| 8 | Settings + states + logs | `design v2 batch 8: settings restyle, error boundary, loading skeleton` | ✅ pushed | `df39955` |
| 9 | Run Report + lock sync | `design v2 batch 9: run report layout, neutral rent metrics, lockfile sync` | ✅ pushed | `f60b7ea` |
| 10 | Full report (print) | `design v2 batch 10: printable full report in v2 styling, neutral rent, CSP-safe print button` | ✅ pushed | `300bb29` |
| 11 | Lease finding | `design v2 batch 11: lease finding as neutral statement (broker decision), info alerts` | ✅ pushed | `e4f7da9` |
| 12 | Light theme | `design v2 batch 12: appearance switch (dark/light/match device), light-mode fixes, themed maps` | ready to push | — |
| 13 | Site PDF = Final Report | `design v2 batch 13: site PDF mirrors the Final Report (shared model, brand fonts)` | ready to push | — |

### Batch 0
Already committed (`0ecddcd`). If `git status` says "Your branch is ahead of 'origin/main'", push it with the Batch 1 push.

### Batch 1
```powershell
git add tailwind.config.ts app/globals.css app/layout.tsx components/ui/Chips.tsx components/ui/Panel.tsx components/ui/StatTile.tsx components/TruthChip.tsx components/GridLogo.tsx docs/DESIGN_V2_CHECKLIST.md
git commit -m "design v2 batch 1: theme tokens, global CSS recipes, UI primitives, dual logo"
git push origin main
```

### Batch 2
```powershell
git add "app/(app)/layout.tsx" components/SidebarNav.tsx components/LogoutButton.tsx components/MobileNav.tsx components/RunDashboard.tsx components/RunPipelineButton.tsx
git commit -m "design v2 batch 2: app shell, sidebar, mobile dialog nav, dashboard verdict strip"
git push origin main
```

### Batch 3
```powershell
git add components/FinalReport.tsx components/SiteIntelligenceTabs.tsx "app/(app)/site/page.tsx" components/LeaseDistributionChart.tsx
git commit -m "design v2 batch 3: Final Report hero + findings, underline tabs, neutral lease cues"
git push origin main
```

### Batch 4
```powershell
git add "app/(auth)/login/page.tsx" components/SteppedIntakeWizard.tsx components/MapMarkers.tsx components/TerritoryMap.tsx components/GapsMap.tsx components/LocationPicker.tsx WORKLOG.md PROJECT_MEMORY.md docs/DESIGN_V2_CHECKLIST.md
git commit -m "design v2 batch 4: login two-column, intake stepper + submit checklist, map markers + legend"
git push origin main
```

### Batch 5
```powershell
git add "app/(app)/runs/page.tsx" components/RunDashboard.tsx components/RunPipelineButton.tsx
git commit -m "design v2 batch 5: all-runs table with results, search/filter, empty + in-progress states"
git push origin main
```

### Batch 6
```powershell
git add components/FranchiseScreeningView.tsx "app/(app)/screening/page.tsx" "app/(app)/intake/page.tsx" components/SteppedIntakeWizard.tsx
git commit -m "design v2 batch 6: franchise screening cards, filter chips, start intake with brand"
git push origin main
```

### Batch 7
```powershell
git add components/SiteIntelligenceTabs.tsx
git commit -m "design v2 batch 7: lease position + zonal floor card, daypart tiles, findings figures"
git push origin main
```

### Batch 8
```powershell
git add "app/(app)/settings/page.tsx" components/ChangePasswordForm.tsx "app/(app)/error.tsx" "app/(app)/loading.tsx" WORKLOG.md PROJECT_MEMORY.md docs/DESIGN_V2_CHECKLIST.md
git commit -m "design v2 batch 8: settings restyle, error boundary, loading skeleton"
git push origin main
```

### Batch 9
```powershell
git add "app/(app)/reports/page.tsx" components/ReportView.tsx components/ReportDownloadModal.tsx lib/modules/reportComposer.ts package-lock.json WORKLOG.md PROJECT_MEMORY.md docs/DESIGN_V2_CHECKLIST.md
git commit -m "design v2 batch 9: run report layout, neutral rent metrics, lockfile sync"
git push origin main
```

### Batch 10
```powershell
git add lib/modules/reportHtml.ts app/api/reports/full/route.ts tests/unit/reportHtml.test.ts
git commit -m "design v2 batch 10: printable full report in v2 styling, neutral rent, CSP-safe print button"
git push origin main
```

### Batch 11
```powershell
git add lib/modules/siteVerdict.ts tests/unit/siteVerdict.test.ts lib/modules/dashboard.ts components/RunDashboard.tsx components/FinalReport.tsx
git commit -m "design v2 batch 11: lease finding as neutral statement (broker decision), info alerts"
git push origin main
```

### Batch 12
```powershell
git add lib/ui/theme.ts components/ThemeSwitch.tsx app/layout.tsx app/globals.css tailwind.config.ts "app/(app)/settings/page.tsx" components/SteppedIntakeWizard.tsx components/VersionHistory.tsx components/DaypartCurve.tsx components/LeaseDistributionChart.tsx components/GapsMap.tsx components/LocationPicker.tsx components/TerritoryMap.tsx tests/unit/theme.test.ts
git commit -m "design v2 batch 12: appearance switch (dark/light/match device), light-mode fixes, themed maps"
git push origin main
```

### Batch 13
```powershell
git add lib/modules/siteReportModel.ts lib/pdf/AnalysisPdf.tsx lib/pdf/pdfFonts.ts lib/pdf/FONTS_LICENSE.md app/api/analysis-report/pdf/route.ts components/SiteIntelligenceTabs.tsx "app/(app)/site/page.tsx" tests/unit/siteReportModel.test.ts tests/fixtures/siteReportSample.ts WORKLOG.md PROJECT_MEMORY.md docs/DESIGN_V2_CHECKLIST.md
git commit -m "design v2 batch 13: site PDF mirrors the Final Report (shared model, brand fonts)"
git push origin main
```

### After the last push
```powershell
git status
git log --oneline -6
```
`git status` should say "nothing to commit". Paste the `git log` output back so the Hash column can be filled.
Netlify redeploys on the push (its build runs `prisma migrate deploy`; there are no new migrations in this work).
