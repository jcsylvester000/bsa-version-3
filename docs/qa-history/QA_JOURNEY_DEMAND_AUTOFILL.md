# QA — User demand tracking & automated POI back-fill (2026-10-09)

Owners: User Journey QA + Code QA & Test Engineer. Scope: the feature that logs what users search for and where
they place intake sites, queues an automatic place-data back-fill where BSA has none, and refreshes the waiting
analysis when the data lands.

## Journeys walked

### J1 — Broker analyses a site in a new area (Baguio, no place data)
| Step | Expected | Result |
|---|---|---|
| Intake → pick location | Picker says searches/pins are logged (admins only, 12 months) | ✓ |
| Review step | Note: few mapped places → BSA collects them and updates the analysis | ✓ |
| Submit & run | Intake saved; demand row `intake_site` = **gap**; one job queued; run `data_refresh_state = waiting`; response `dataPending: true` | ✓ (service e2e) |
| Dashboard / site page | "Gathering place data for this area" note, page refreshes every 60 s while visible; runs list badge "◌ Gathering place data" | ✓ (render test) |
| Scheduled pass | Boundaries loaded; layers fetched one at a time; places saved Verified ("Auto-fill · Brgy Kabayanihan, Baguio City"); one timed-out layer → retry list + back-off | ✓ |
| Next pass after back-off | Missed layer filled; job **done**; retry entry closed; run recomputed (`runPipeline(refresh)`), state `done` | ✓ |
| Dashboard | "✓ Updated with new place data — recomputed automatically …" | ✓ |
| Same area again | Now **covered** — no new job | ✓ |

### J2 — Area OpenStreetMap can't serve (all layers fail)
Three rounds (immediate, +20 min, +40 min) → job **failed**; waiting run → `unavailable`: note says data is still
limited and is on the admins' list — it never claims "updated". Admin **Retry** → run waits again. ✓

### J3 — Admin works the demand
Capture Coverage → **User demand** (Needs data / All / Searches / Intake sites; who, what, where, places then,
covered/partial/gap, job status) → **Queue back-fill** on a search in a gap → **Automatic back-fill** → **Run now**
→ summary line (layers filled, new places, retries, boundaries, seconds). Demand points on the map (ring = data then).
Cancel / Retry jobs; "Capture by hand" opens Place Capture at the spot. ✓ (headless, mocked API)

### J4 — Busy / rich areas
Makati: ≥ 60 stored places → covered, no job (no needless re-fetch of bulk-ingested NCR); dense-centre ring 1,000 m. ✓
Searches alone never queue a job (cost control); only intake sites or an admin do. ✓

## Issues found during the pass and fixed
1. **False "Updated" message** when a job ended with no data (failed/cancelled) → new `unavailable` state + candid note;
   only jobs that added places mark runs for refresh.
2. **Cancel left runs "gathering" forever** → cancel releases them (refresh if data arrived, else `unavailable`); retry
   puts them back to waiting.
3. **Intake latency** with several sites → demand recorded for all sites in parallel.
4. **'other' business type** would have queued a broad `shop=*` pull → excluded from back-fill layers.
5. **Auto-fill batches showed "—" as author** in the capture log → "Automatic back-fill".
6. Next.js route files may not export helpers → cron auth moved to `lib/api/cron.ts`.
7. Privacy transparency (RA 10173) → notice in the location picker; admin-only API; purge script.

## Automated checks
- `tests/unit/demandAutofill.test.ts` — coverage rule, job merging, layer choice, dense ring, cron secret (fails closed),
  admin-only routes, validation, 409 on bad transitions.
- `tests/unit/dataGatheringNote.test.ts` — wording per state; nothing for normal runs.
- Local real-DB e2e (PG16 + PostGIS through the Neon HTTP adapter, emulated): J1, J2 and admin queue/cancel/retry
  (not shipped; needs local Postgres).
- tsc clean · vitest 574/574 · next build OK · headless admin screens: no console errors.

## Not covered / follow-ups
- Full browser journey against a live database (sandbox has no Prisma engine) — owner smoke test after deploy.
- No e-mail/SMS notification when an analysis updates (the dashboard note + badge only).
- Consider marking verdicts "provisional" in the PDF while data is still being gathered.
