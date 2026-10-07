# Place Capture playbook — complete data on the first try

_Audience: Grid admins capturing places for new areas (Admin → Place Capture / Capture Coverage). 2026-10-08._

## Enforced in the app (2026-10-08)

The rules below are built into Admin → Place Capture and Capture Coverage (`lib/capture/capturePolicy.ts`), not just advice:

| Practice | How the app applies it |
|---|---|
| Check coverage first, capture gaps | Capture Coverage map + "What to capture next"; the capture map draws saved areas (green fresh / grey due / red retry); the **Before you capture** checklist lists layers already captured here — they are skipped |
| Boundaries before capturing | No barangay boundary at the pin → capture is blocked until boundaries are loaded or the admin ticks "Capture anyway"; Coverage shows boundaries per region |
| Ring 700–1,000 m in dense centres, ≤ 1,500 m in towns | Slider is capped per spot (dense centres list or ≥ 300 stored places/km²), default 800 m when dense; the server rejects bigger rings (`ring_too_large`) |
| 2–3 business types | Max 3 per capture on screen and in the API |
| One area at a time, don't reload | The next area is blocked until the current one is saved or removed; the browser warns before leaving while loading |
| Off-peak (5 AM–12 PM PHT) | Live banner with the window and OpenStreetMap's free slots; the capture waits for a free slot (≤ 45 s); retries wait longer in busy hours |
| Save even if a layer failed | Save is always available ("Mark this area as captured" when nothing is new); missed layers go to the retry list |
| Re-capture after 90 days | Coverage older than 90 days is "due", fetched again, listed in "What to capture next" |

## Why captures miss data

Place Capture asks the **public OpenStreetMap Overpass servers** for each layer, one layer per request. Those
servers are shared worldwide and rate-limit busy users, so a layer can time out (slow server) or come back
**incomplete** (more than 5,000 places in one ring — dense CBDs). BSA now handles both:

| What happens | What BSA does automatically | What the admin does |
|---|---|---|
| A layer times out / errors | Retries it twice (after 4 s and 10 s), switching Overpass server; then logs it in the **retry queue** | Save what loaded; retry the queue entry later |
| A layer hits the place limit | Marks it **▲ incomplete**, does **not** mark the area covered, logs it (`limit`) | Re-capture that area in smaller rings |
| The area was captured < 90 days ago | Skips the layer (no OpenStreetMap call), shows saved places faded | Nothing — use "refresh" only if places changed |
| A saved place appears again | Never saved twice (`ON CONFLICT DO NOTHING`) | Nothing |

Retry-queue entries close **by themselves** when saved captures of that layer (from the last 90 days) cover the
area — one ring or several smaller ones.

## Before you start

1. **Open Capture Coverage first.** Green = captured (skipped for 90 days), grey = re-capture due, red dashed =
   retry queue. Work the gaps; don't re-scan green areas.
2. **Load the region's barangay boundaries** (`npm run db:fetch-boundaries -- --region=<region>` then `npm run db:load-boundaries`) so saved
   places are tagged with barangay / city / province.

## During a capture

3. **Ring size:** 1,500 m for towns and provincial centres; **700–1,000 m** for city centres and malls (Makati,
   Ortigas, BGC, Cebu IT Park, Davao Poblacion). Max area per capture is 25 km².
4. **Business types:** tick only the ones you need (2–3 at a time). Every layer is one more Overpass request.
5. **One area at a time:** let all layers finish ("Loading 3 of 6…") before adding the next area; don't reload the page.
6. **Let the automatic retries run.** If a layer still fails, Save anyway — everything that loaded is stored and
   marked covered; only the missed layer stays in the queue.
7. **Off-peak:** early morning to midday Philippine time (European night) is when Overpass is least busy.
8. **Refresh sparingly:** only when you know an area changed (new mall, new commercial strip).

## After a capture

9. Read the **status screen**: new places saved, already in BSA, barangay-tagged, cells marked captured, and any
   layers sent to the retry queue.
10. Work the **retry queue** (Capture Coverage → Retry queue → *Retry now* opens Place Capture on exactly that area
    and layer; *Recapture smaller* for place-limit entries; *Dismiss* when there is genuinely nothing to capture).
11. **Re-capture after 90 days** (grey areas) so Territory Guard sees openings and closures.

## Limits & safety (for the dev team)

- Admin-only routes; preview is read-only for place data (it only writes retry-queue bookkeeping); Save is the only
  place write. 240 preview calls / admin / hour.
- Overpass: 20 s budget per request split over two endpoints, 30-minute in-memory cache, selectors built only from
  constant tables (no client text in Overpass QL).
- Neon HTTP adapter: no `createMany`, nested writes or `$transaction` on these paths (HTTP mode refuses
  transactions) — plain statements only.
- Production hardening to consider: a self-hosted or paid Overpass instance (removes public rate limits), and a
  background job that works the retry queue overnight.
