# Corridor traffic + seasonality (R-07)

Loads corridor rows into `traffic_corridor` so the **Daypart & Seasonality** read works for
Cavite/Batangas. A site's corridor (from `inferCorridor`) is looked up here for its seasonal
low/high multipliers (Christmas, Undas, Holy Week, payday, school-open …).

Two parts, with different Truth Layers:

- **Base AADT band** (`baseBand` + `aadtRef`) — the *empirical* part. It must come from a
  **DPWH ATTAS** average-daily-traffic count on the corridor's main road. Leave `aadtRef` `null`
  and `truthLayer` `projected` until you enter a real count; then set the count and raise the
  Truth Layer to `assumed`/`verified`.
- **Seasonal multipliers** (`seasonal{...}`) — a documented **MODEL** (Projected), a modelled
  range, never a live count. The provinces differ from NCR in direction, which the templates encode:
  - **Undas** — the provinces *receive* the Metro Manila exodus, so gateway/urban corridors **spike**
    (the opposite of the NCR intra-metro dip).
  - **Holy Week** — **tourism** corridors (Tagaytay–Silang, Batangas City port/beach gateways) **peak**,
    while commuter/industrial corridors (Bacoor–Imus, Sto. Tomas–Tanauan) **dip** as commuters leave.
  - **Christmas / payday / school-open** — broadly as NCR.

## Templates (start here)

Province templates ship with the corridor names from R-06 and the Projected seasonal shapes above,
with `aadtRef: null`:

- `prisma/data/traffic/cavite.template.json` — Bacoor–Imus, Dasmariñas–General Trias, Tagaytay–Silang
- `prisma/data/traffic/batangas.template.json` — Sto. Tomas–Tanauan, Lipa, Batangas City

Review the multipliers, fill `aadtRef` from DPWH ATTAS, then load the file directly (or copy it to
`cavite.json` / `batangas.json` and edit that — the plain `.json` names are git-ignored so your
counts stay local).

## Load

```powershell
npm run db:load-traffic -- --region=cavite   --file=prisma/data/traffic/cavite.template.json
npm run db:load-traffic -- --region=batangas --file=prisma/data/traffic/batangas.template.json
```

Idempotent (upsert on corridor). `--region` only validates the corridor names against the registry
(a typo is warned, not blocked). A row without a corridor or a seasonal map is skipped.

## File shape

Same as `prisma/data/trafficSeasonality.real.json` (the NCR/Davao seed):

```json
[
  {
    "corridor": "Lipa",
    "baseBand": "high",
    "aadtRef": null,
    "truthLayer": "projected",
    "notes": "…",
    "source": "DPWH ATTAS (Ayala Highway, Lipa)",
    "seasonal": {
      "normal":    { "low": 1.0,  "high": 1.0,  "truthLayer": "assumed",   "label": "Ordinary weekday" },
      "christmas": { "low": 1.25, "high": 1.6,  "truthLayer": "projected", "label": "Christmas peak" }
    }
  }
]
```
