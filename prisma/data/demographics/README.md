# Barangay demographics (R-04)

Loads PSA 2020 census **barangay populations** into `demographic_cell`, tied to the R-02
barangay polygons. This is what lets Site Fit / Daypart / White-Space score Cavite & Batangas
sites (and stops confidence defaulting to Low there). Population is **Verified** (census).

CSV files here are **git-ignored** (provide per environment).

## 1. Load boundaries first

Populations attach to the barangay polygons by PSGC, so run R-02 first:

```powershell
npm run db:fetch-boundaries -- --region=cavite
npm run db:fetch-boundaries -- --region=batangas
```

## 2. Get a barangay-population CSV

Any CSV keyed by **10-digit PSGC barangay code** with a **population** column works — the loader
auto-detects common column names (`ADM4_PCODE`/`adm4_psgc`/`PSGC`; `T_TL`/`population`/`pop_2020`).
Recommended sources:

- **HDX — Philippines COD population statistics (Admin 4)**: the OCHA/PSA "cod-ps-phl" dataset,
  file `phl_admpop_adm4_2020.csv`. <https://data.humdata.org/dataset/cod-ps-phl>
- **PSA FOI — CPH 2020 Data by Barangay with 10-digit PSGC**:
  <https://www.foi.gov.ph/agencies/psa/cph-2020-data-by-barangay-with-10-digit-psgc/>

Minimum columns the loader needs (others are ignored):

| Column (any alias)                    | Meaning                    | Truth Layer |
| ------------------------------------- | -------------------------- | ----------- |
| `ADM4_PCODE` / `adm4_psgc` / `PSGC`   | 10-digit barangay PSGC     | key         |
| `population` / `T_TL` / `pop_2020`    | total population (2020)    | Verified    |
| `adm4_en` / `barangay` (optional)     | barangay name              | Verified    |
| `income_band`, `daytime_pop` (opt.)   | if present                 | Assumed     |

## 3. Load

```powershell
# from a downloaded file:
npm run db:load-demographics -- --region=cavite --file=prisma/data/demographics/cavite.csv
# or straight from a URL:
npm run db:load-demographics -- --region=cavite --url=https://…/phl_admpop_adm4_2020.csv
```

The loader upserts on PSGC and copies each barangay's boundary geometry from `admin_boundary`.
It reports rows with no population column or no matching boundary. Re-runnable.

> Guardrail: only real census populations are loaded — BSA never fabricates population. Barangays
> without data simply stay unscored (honest gap) until a CSV is provided.
