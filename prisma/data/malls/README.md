# Provincial mall roster (R-07)

Loads malls into `mall_property` so the **Mall Match** module works for Cavite/Batangas sites: it
finds the nearest mall by location and reads its tier + footfall band against the site's target
tier. CSV files here are git-ignored.

**Guardrail:** a mall's tier and footfall band are never fabricated. A row missing either is skipped
(the loader reports the skip). Footfall is a modelled band, not a live count — it keeps its Truth
Layer (`assumed` unless a row is marked `verified`).

## Source

Assemble the provincial mall roster from operator directories and map data:

- **SM Supermalls / Robinsons Malls / Ayala Malls / Vista Malls / WalterMart** store-locator pages
  for the province (name, city, coordinates).
- **OSM / Google Maps** for `lat`/`lon` when a locator omits them (required — geom is built from
  them; a mall without coordinates loads but won't be matched to a site).
- Tier and footfall band from the operator's format (super-regional → A/very_high; regional →
  B/high; community → B–C/medium; strip/neighbourhood → C/low). Mark `verified` only when the band
  is backed by a published figure.

## CSV format

| Column (any alias)                          | Meaning                                            |
| ------------------------------------------- | -------------------------------------------------- |
| `mall_name` / `name`                        | mall name (upsert key)                             |
| `city` / `lgu`                              | LGU                                                |
| `tier` / `grade`                            | **A** / **B** / **C** (required)                   |
| `footfall_band` / `traffic_band`            | **very_high** / **high** / **medium** / **low** (required) |
| `lat`, `lon`                                | coordinates (required for the spatial match)       |
| `rent_band_php_sqm` (optional)              | indicative GLA rent band text                      |
| `cusa_band` (optional)                      | indicative CUSA band text                          |
| `truth_layer` (optional)                    | `verified` / `assumed` (default)                   |

Example:

```csv
mall_name,city,tier,footfall_band,lat,lon,truth_layer,rent_band_php_sqm
SM City Bacoor,Bacoor,A,very_high,14.4585,120.9430,assumed,1200-2200
Vista Mall Dasmariñas,Dasmariñas,B,high,14.3290,120.9370,assumed,900-1600
Robinsons Place Lipa,Lipa,B,high,13.9440,121.1640,assumed,900-1600
```

## Load

```powershell
npm run db:load-malls -- --region=cavite   --file=prisma/data/malls/cavite.csv
npm run db:load-malls -- --region=batangas --file=prisma/data/malls/batangas.csv
# or --url=<direct csv link>
```

Idempotent (upsert on mall name; the region is stamped and geom rebuilt from lat/lon each run).
