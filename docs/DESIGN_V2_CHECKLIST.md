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

## Verification (every batch)
- [x] `tsc --noEmit` 0 errors (2026-09-25, cloud sandbox)
- [x] `vitest run` 36 files · 426/426 passing (Prisma-engine "unhandled" notices are sandbox-only)
- [x] `next build` compiles every route
- [ ] Browser check by owner after deploy (keyboard: skip link → rail → tabs ← → → content → footer;
      44px targets; every verdict = icon + word; compare with `design-reference/*.dc.html`)

## Deferred / not in scope
- [-] Light-theme Settings toggle + cookie (owner chose dark only; tokens are ready)
- [-] `FindingsList` `figures` (headline number per finding) — optional in the bundle; left empty so no
      figure is shown without a traced source. Wire from the module payloads in a later pass.

---

## Push log
Update this table on every push (hash = first word of `git log --oneline -1` after the push).
Commands are PowerShell 5-safe (one per line). Run them from `4 - Final Application`, in order.
`:(literal)` stops git reading `[id]` as a wildcard.

| # | Batch | Commit message | Status | Hash |
|---|---|---|---|---|
| 0 | Pending audit fixes | `audit batch 2: CI (F-48), migrate-on-deploy (F-49), build id in footer (F-50), mobile nav (F-32), fix onboarding tour (F-33), pipeline maxDuration (F-04)` | committed by owner — confirm pushed | `0ecddcd` |
| 1 | Foundation | `design v2 batch 1: theme tokens, global CSS recipes, UI primitives, dual logo` | ready to push | — |
| 2 | Shell + dashboard | `design v2 batch 2: app shell, sidebar, mobile dialog nav, dashboard verdict strip` | ready to push | — |
| 3 | Site page + Final Report | `design v2 batch 3: Final Report hero + findings, underline tabs, neutral lease cues` | ready to push | — |
| 4 | Login, intake, maps + logs | `design v2 batch 4: login two-column, intake stepper + submit checklist, map markers + legend` | ready to push | — |

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

### After the last push
```powershell
git status
git log --oneline -6
```
`git status` should say "nothing to commit". Paste the `git log` output back so the Hash column can be filled.
Netlify redeploys on the push (its build runs `prisma migrate deploy`; there are no new migrations in this work).
