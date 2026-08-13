# Integration smoke test — intake → run → Territory Guard

These checks were run against the built app on a local Postgres seed and all pass.
They double as a manual QA script for the dev team. (A full automated integration
harness — spinning Postgres + the Next server in CI — is a documented next step.)

## Setup
```bash
docker compose up -d          # local Postgres + pgvector + PostGIS
npm run prisma:deploy         # apply the migration
npm run db:seed               # demo franchisor, outlets, users, run
npm run build && npm start    # serve on :3000
```

## 1. Auth
| Case | Expected |
|------|----------|
| `POST /api/auth/login` valid creds | `200`, sets `bsa_session` httpOnly cookie |
| wrong password | `401 invalid_credentials` (no user-enumeration) |
| unauthenticated `POST /api/territory-guard` | `401 unauthorized` |

## 2. Access scoping (Security veto)
| Case | Expected |
|------|----------|
| broker A reads own franchisor run | `200` |
| broker B (other franchisor) reads run A via `GET /api/territory-guard` | `403 forbidden` |
| broker B runs run A via `POST` | `403 forbidden` |
| broker B `GET /api/runs` | `200`, empty list — no leakage |

## 3. Validation
| Case | Expected |
|------|----------|
| `POST /api/territory-guard` bad `runId` | `422 validation_error` |
| `POST /api/intake` below 80% completeness | `422 completeness_gate` with missing sections |

## 4. Territory Guard compute (the P1 result)
Seeded candidate "BGC 7th Ave" sits 353 m / 565 m from two BGC branches:
- `maxOverlapPct` = **75.2** (Verified)
- `verdict` = **redistributes**, flag `high_cannibalization_risk`
- `totalCannibalizedPhp` = **683,820** (Projected)

Seeded candidate "Alabang" is far from every branch:
- `maxOverlapPct` = **0**, `verdict` = **adds**

## 5. Truth Layer + provenance
- `module_result.territory` written with `truth_layer=projected` (weakest field drives the row).
- Every AI verdict logged to `ai_generation` with `retrieved_chunk_ids` — full provenance.
- The generated verdict phrases only the grounded facts; it introduces no new number.
