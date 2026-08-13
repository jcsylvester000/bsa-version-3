# Territory Guard — Google Maps Integration Test

**Prepared for:** Joseph Sylvester · Grid Property Ventures
**Date:** 2026-08-04
**Goal:** Confirm Territory Guard uses the Google Maps API to find locations, compute
trade-area overlaps, and display them to recommend areas — and that it actually works.

---

## What Territory Guard uses Google for

| Piece | Google API | Where | Purpose |
|---|---|---|---|
| Find a location | Geocoding | `lib/geo/geocode.ts` → `/api/geocode` | Turn a typed address into real lat/lon at intake |
| Find competitors | Places (New) — searchNearby | `lib/places/placesService.ts` | Pull real competing establishments near a candidate |
| Basemap | Map Tiles — createSession + 2dtiles | `/api/maptiles` + `/api/maptiles/[z]/[x]/[y]` | Google roadmap tiles under the overlap rings |
| Overlap + recommendation | (compute, not Google) | `lib/modules/territoryGuard.ts` + `TerritoryMap.tsx` | Measure overlap %, draw rings, colour by verdict |

The `GOOGLE_API_KEY` stays server-side throughout — the browser calls our routes, which
call Google. Tiles are proxied so the key never reaches the client.

---

## Tests run (live against the configured key)

**1. Geocoding — finds real locations. ✅**
`"Ayala Avenue Makati"` → `14.5564, 121.0218` (Ayala Ave, Makati City). `"BGC High Street
Taguig"` → `14.5507, 121.0504` (Bonifacio Global City). Real coordinates, PH-bounded.

**2. Places — finds real competitors. ✅**
`searchNearby(cafe/coffee_shop)` around the Makati Ayala candidate returned real, named
establishments: Yardstick Coffee, The Black Bean, Odd Cafe, Baker on East, The Curator,
TOMORO Coffee… (20 total within 1.5 km).

**3. Map Tiles — basemap works. ✅**
`createSession` minted a valid session token; fetching `2dtiles/12/x/y` with it returned a
real `256×256 image/png` Google roadmap tile. The app's `/api/maptiles` route wraps this and
returns a proxied `tileUrlTemplate`; the map falls back to OpenStreetMap only if the key is
absent.

**4. Overlap computation + area recommendation — end to end. ✅**
Running Territory Guard for a real candidate (Makati Ayala Ave) against the real
Macao Imperial Tea outlet cluster produced:
- **75.3% max overlap** with the real One Ayala branch at **352 m** → verdict **redistributes**
- **₱340,200** estimated monthly cannibalization (Projected)
- **20 real competitors** attached for the map
- Map data contract validated: every catchment ring, competitor dot, and the
  verdict-coloured candidate ring has valid geometry.

The **area recommendation** is the verdict colour on the candidate ring: green *Adds sales*,
amber *Mixed*, red *Redistributes* — so a user sees at a glance whether a spot is a fresh
area or one that eats an existing branch.

---

## Fixes / hardening applied

- **Extracted the ring geometry** (`geoCircle`, `VERDICT_COLOR`) into `lib/geo/mapGeometry.ts`
  (pure, no map-library import) so the catchment-ring math is unit-testable independent of the
  browser render layer. `TerritoryMap.tsx` now imports them.
- **Added `tests/unit/mapGeometry.test.ts`** (5 tests): ring is closed, points sit within ~5%
  of the requested radius, scales with radius, honours segment count, and each verdict maps to
  a distinct recommendation colour.
- (From the prior QA pass) the pipeline path now also pulls + persists real competitors, so the
  dashboard/report competition read matches the live map.

---

## Verification

- Live Google calls: geocoding, Places, tile session, and a real tile fetch all succeeded.
- In-process end-to-end Territory Guard run: overlap + 20 competitors + valid map geometry.
- `tsc` clean, `next build` ✅, full suite green (**168 tests**, +5 new map tests).

## Note on limits

The one thing not exercised here is a live browser screenshot of the rendered tiles — the app
runs on the cloud sandbox's localhost, which the desktop browser can't reach. Every server-side
piece the browser depends on (session, tile proxy, geocode, Places, overlap) is verified working,
and the render layer (maplibre drawing the returned tiles + rings) is standard. To see it
visually, run the app locally (`npm run dev`), open a run's Territory Guard, and click **Run
Territory Guard** — the Google basemap loads with the catchment rings and competitor dots.
