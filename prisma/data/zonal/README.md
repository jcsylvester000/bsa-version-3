# BIR zonal values (R-05)

Loads BIR zonal values into `zonal_value`, so the Lease Benchmark's zonal cross-check and the
Land zoning screen work for a province. **Zonal values are a tax-reference floor only — never a
market price** (enforced everywhere in the app). CSV files here are git-ignored.

## Source (BIR schedules)

Zonal values are published per Revenue District Office (RDO), as documents. For CALABARZON:

- **Cavite** — RDO **54A** (Trece Martires / East Cavite) and **54B** (Bacoor / West Cavite)
- **Batangas** — RDO **58** and **59**

Get the latest schedules from the BIR zonal values page: <https://www.bir.gov.ph/zonal-values>
(navigate to Revenue Region 9A – CABAMIRO). An analyst flattens the schedule into a CSV.

## CSV format

One row per (LGU [, barangay], classification). The loader auto-detects common headers and
canonicalises the LGU to match how sites resolve. Minimum columns:

| Column (any alias)                              | Meaning                                   |
| ----------------------------------------------- | ----------------------------------------- |
| `city` / `municipality` / `lgu`                 | LGU (e.g. "Bacoor", "Imus")               |
| `barangay` (optional)                           | barangay name (blank = city-grain row)    |
| `classification` / `class`                      | BIR class — **CR** / **CC** are the ones the app reads |
| `zonal_value` (or `low` + `high`)               | ₱/sqm; a single value fills low = high    |
| `rdo` (optional)                                | RDO code (54A/54B/58/59)                  |

Example:

```csv
city,barangay,classification,zonal_value,rdo
Bacoor,Molino IV,CR,9500,54B
Bacoor,,CR,8000,54B
Imus,Poblacion,CR,12000,54B
```

## Load

```powershell
npm run db:load-zonal -- --region=cavite   --file=prisma/data/zonal/cavite.csv
npm run db:load-zonal -- --region=batangas --file=prisma/data/zonal/batangas.csv
# or --url=<direct csv link>
```

Idempotent (upsert on region + LGU + barangay + RDO + classification). After loading, a Cavite/
Batangas lease benchmark shows the BIR band and rent-to-zonal cross-check, and the Land zoning
screen resolves instead of reading "unknown".
