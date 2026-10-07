# Place Capture playbook — complete data on the first try

_Audience: Grid admins capturing places for new areas (Admin → Place Capture / Capture Coverage). 2026-10-08._

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
2. **Load the region's barangay boundaries** (`npm run db:boundaries -- <region>` then `db:load-boundaries`) so saved
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
