# Provincial lease comps (R-06)

Loads lease comparables into `lease_comp` so the **Lease Benchmark** gives a real corridor read
for Cavite/Batangas sites (rent range, median, percentile, negotiating room) instead of falling
back to the BIR-zonal indicative band only. CSV files here are git-ignored.

**Guardrail:** BSA never invents a rate. Every comp comes from a broker observation or a published
band, and keeps its Truth Layer. BSA reports where an asking rent *sits* in the corridor — it never
issues a price verdict, and the broker still closes the deal (RA 9646 framing unchanged).

## Corridors

Comps are grouped by corridor. The loader maps an LGU/barangay to its corridor automatically, so
the CSV can carry either the corridor name or just the town. Registry corridor names:

| Region   | Corridors                                                            |
| -------- | ------------------------------------------------------------------- |
| Cavite   | `Bacoor–Imus` · `Dasmariñas–General Trias` · `Tagaytay–Silang`       |
| Batangas | `Sto. Tomas–Tanauan` · `Lipa` · `Batangas City`                     |

(Add or split a corridor in `lib/geo/regions.ts` — it is configuration, not code.)

## Source

Provincial retail rents are not centrally published like NCR bands. Assemble from:

- **Broker corridor bands** — Colliers / Leechiu / KMC / Santos Knight Frank CALABARZON retail
  briefs, and local brokerage asking-rent sheets. Published bands → `verified`.
- **Live listings** (Lamudi / MyProperty / Facebook Marketplace commercial) for observed asking
  rents → `assumed` (a single point, not a published band).
- **Mall GLA rates** for a named property (SM, Robinsons, Ayala Malls, Vista, WalterMart in the
  province) → `format = mall`, set `mall_name`.

Aim for **≥5 comps per (corridor, format)** — below that the benchmark is flagged low-sample and
the read leans on the BIR-zonal indicative band (already region-aware from R-05).

## CSV format

One row per comp. The loader auto-detects common headers (case-insensitive) and strips ₱/commas.

| Column (any alias)                                   | Meaning                                        |
| ---------------------------------------------------- | ---------------------------------------------- |
| `corridor` / `area` / `lgu` / `city`                 | corridor name, or a town the loader maps to one |
| `format` / `type`                                    | `inline` / `mall` / `highstreet` / `kiosk` (default `inline`) |
| `mall_name` (optional)                               | property name when `format = mall`             |
| `base_rent_php_sqm` / `rent`                          | monthly base rent ₱/sqm (the headline)         |
| `escalation_pct` (optional)                          | annual escalation %                            |
| `cusa_php_sqm` (optional)                             | common-area dues ₱/sqm                         |
| `lease_term_years` (optional)                        | term in years                                  |
| `fitout_months` (optional)                           | rent-free fit-out months                       |
| `observed_date` (optional)                           | as-of date (YYYY-MM-DD)                        |
| `truth_layer` (optional)                             | `verified` (published band) / `assumed` (default) |
| `sample_source` (optional)                           | broker / brief / listing note                  |

A row with a corridor but **no numeric term at all** is dropped (never a fabricated comp).

Example:

```csv
corridor,format,base_rent_php_sqm,escalation_pct,cusa_php_sqm,lease_term_years,fitout_months,observed_date,truth_layer,sample_source
Bacoor–Imus,inline,900,5,120,5,2,2026-06-01,verified,Colliers CALABARZON retail brief H1-2026
Bacoor,inline,1050,5,140,5,2,2026-06-10,assumed,Lamudi asking rent (Molino Blvd)
Dasmariñas–General Trias,mall,1400,6,220,5,3,2026-05-20,assumed,Vista Mall Dasma GLA rate
Tagaytay,highstreet,1300,5,,5,2,2026-04-15,assumed,Local brokerage sheet (Tagaytay ridge)
```

## Load

```powershell
npm run db:load-lease -- --region=cavite   --file=prisma/data/lease/cavite.csv
npm run db:load-lease -- --region=batangas --file=prisma/data/lease/batangas.csv
# or --url=<direct csv link>
```

Idempotent — each run clears the (format, corridor) groups present in the CSV, then inserts fresh.
After loading, a Cavite/Batangas Lease Benchmark shows the corridor rent range + median and, once
an asking rent is entered, its percentile and negotiating room to the median.
