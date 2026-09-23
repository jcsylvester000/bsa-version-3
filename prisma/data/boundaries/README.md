# Administrative boundaries (R-02)

BSA tags every POI and candidate site with its real **barangay / city / province** by
point-in-polygon against `admin_boundary`.

## Easiest: auto-download (no GDAL, no shapefiles) — recommended

Pulls ready-made GeoJSON (province → cities → barangays) from
[faeldon/philippines-json-maps](https://github.com/faeldon/philippines-json-maps) (MIT, PSGC
Q4-2023) and loads it straight into Neon. Needs only network + Node 18+.

```powershell
npx prisma migrate deploy        # if not already applied
npm run db:fetch-boundaries -- --region=cavite
npm run db:fetch-boundaries -- --region=batangas
npm run db:tag-boundaries        # backfill existing POIs/sites (new sites tag at intake)
```

That's it. Everything below is the manual alternative (only if you'd rather use your own
shapefiles / a specific PSGC vintage). Auto-download supports regions that have `psgcRegionCode`
+ `psgcProvinces` in `lib/geo/regions.ts` (currently Cavite, Batangas; add codes for others).

---

## Manual alternative: shapefiles + ogr2ogr

The `.geojson` files are **git-ignored** (large; provide them per environment).

## 1. Get the shapefiles (official PSGC)

Source: <https://github.com/altcoder/philippines-psgc-shapefiles> (MIT, tracks PSA PSGC).
It uses `git-lfs`, so:

```bash
git lfs install
git clone https://github.com/altcoder/philippines-psgc-shapefiles.git
# dist/ contains PH_Adm1_Regions, PH_Adm2_ProvDists, PH_Adm3_MuniCities, PH_Adm4_BgySubMuns (.shp.zip)
```

Unzip the `.shp.zip` you need (Adm3 = city/municipality, Adm4 = barangay).

## 2. Convert to GeoJSON, filtered per province, reprojected to WGS84

`ogr2ogr` (from GDAL). The attribute that names the province may differ by release — open the
`.dbf`/attributes once to confirm (commonly `adm2_en`). Reproject to EPSG:4326.

```bash
# Cavite — barangays and cities
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -where "adm2_en = 'Cavite'"   cavite_barangays.geojson   PH_Adm4_BgySubMuns.shp
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -where "adm2_en = 'Cavite'"   cavite_cities.geojson      PH_Adm3_MuniCities.shp

# Batangas — barangays and cities
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -where "adm2_en = 'Batangas'" batangas_barangays.geojson PH_Adm4_BgySubMuns.shp
ogr2ogr -f GeoJSON -t_srs EPSG:4326 -where "adm2_en = 'Batangas'" batangas_cities.geojson    PH_Adm3_MuniCities.shp
```

Put the resulting `.geojson` files in this folder.

## 3. Load into Neon, then tag existing points

Load cities first (parents), then barangays, per region:

```bash
npm run db:load-boundaries -- --region=cavite   --level=city     --file=prisma/data/boundaries/cavite_cities.geojson
npm run db:load-boundaries -- --region=cavite   --level=barangay --file=prisma/data/boundaries/cavite_barangays.geojson
npm run db:load-boundaries -- --region=batangas --level=city     --file=prisma/data/boundaries/batangas_cities.geojson
npm run db:load-boundaries -- --region=batangas --level=barangay --file=prisma/data/boundaries/batangas_barangays.geojson

# Point-in-polygon backfill of poi / candidate_site / mall_property (barangay, city, province, PSGC):
npm run db:tag-boundaries            # untagged rows only
# npm run db:tag-boundaries -- --all # re-tag everything after a boundary refresh
```

New candidate sites are tagged automatically at intake time (runtime lookup).

## Notes

- The loader prints any features it can't map and the property keys it saw — if your file uses
  different code/name fields, add them to `KEYS` in `lib/geo/boundaryFeature.ts` and re-run.
- Truth Layer for boundaries is **Verified** (official PSA/PSGC).
- NCR/Davao boundaries can be loaded the same way (Adm3/Adm4 filtered to those provinces) to
  replace the coarse bbox region tags with true barangays.
