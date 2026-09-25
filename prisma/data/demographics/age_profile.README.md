# Real PSA age-sex tables (F-18)

`db:enrich-age` writes `demographic_cell.age_profile`. It prefers a **real PSA age-sex table**
when you provide one, and falls back to a modelled income-band proxy per cell.

## File

`prisma/data/demographics/age_profile.real.json` (optional). Shape — keyed by barangay **PSGC code**
(the same `psgc_code` loaded into `demographic_cell`):

```json
{
  "1380100001": { "p0_14": 27.4, "p15_44": 45.1, "p45plus": 27.5 },
  "1380100002": { "p0_14": 31.0, "p15_44": 44.0, "p45plus": 25.0 }
}
```

- Three bands: `p0_14`, `p15_44`, `p45plus` (the healthcare-relevant `45+` cohort).
- Values may be raw counts or percentages — they're normalised to sum to 100 on load.
- Source: PSA 2020 Census of Population and Housing, Age–Sex tables (per barangay).

## Truth Layer

- A cell **matched** in the file → `basis: "PSA census age-sex table"`, `truthLayer: verified`.
- A cell **not** in the file → modelled from income band, `truthLayer: projected` (honest proxy).

When the file is absent, every cell uses the proxy — the prior behaviour. Re-run any time; the
script is idempotent.
