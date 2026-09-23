# BSA Security Posture & Pre-Handoff Checklist

Security review notes for the dev team. This agency builds development-ready code; the dev
team hardens further. Nothing here leaves with a known, unflagged hole — open items are
listed explicitly.

## What is in place

- **Secrets server-side only.** No API key, connection string, or token reaches the
  browser. `.env` is git-ignored; `.env.example` carries names only. Prisma and bcrypt are
  marked server-external so they never enter the client bundle. The Google API key from
  intake material is referenced by env name, never committed.
- **Auth.** JWT (jose, HS256, 8h) in an httpOnly, SameSite=Lax cookie (Secure in prod);
  passwords hashed with bcrypt (cost 12). No home-rolled crypto.
- **Role-based access at the boundary.** Four roles (admin/analyst/broker/franchisor).
  `canAccessFranchisor` is enforced in the route handlers, not just the UI — verified:
  a broker for another franchisor gets `403` on read and run, and an empty runs list (no
  data leakage). Login does not enumerate users.
- **Input validation.** Every endpoint validates with Zod at the boundary, including PH
  lat/lon sanity bounds. All DB access is through Prisma (parameterized); the two raw
  queries (geo `ST_DWithin`, `doc_chunk` keyword search) use tagged-template parameters —
  no string-concatenated SQL.
- **Prompt-injection / grounding boundary.** The AI layer is retrieve-then-generate: the
  model sees only retrieved, classified context and the deterministic facts; the system
  instruction forbids introducing numbers or answering from outside knowledge. Every call
  is logged to `ai_generation` with the retrieved chunk ids for provenance.
- **Audit logging.** Sensitive actions (login, intake submit, run) write to `audit_log`
  (governance requirement, intake Section K).

## Hardening added in the 2026-09-23 review (Batches 1–5)

- **Admin routes role-gated** — `/api/admin/reconcile-composites` + `/api/admin/warm` admin only;
  `/api/admin/data-stats` staff only (`isAdmin` / `isStaff` in `lib/auth/auth.ts`).
- **Fail-closed signing secret** — `lib/auth/secret.ts`: on Netlify/Vercel (or `BSA_REQUIRE_SECRET=1`)
  a missing/short `AUTH_SECRET` throws; the dev fallback is local-only. Storage signatures are
  domain-separated from session JWTs.
- **Demo logins off on deployments** unless `BSA_ALLOW_DEMO_LOGINS=1`; admin/analyst demo accounts never.
- **Brute-force protection** — `lib/auth/rateLimit.ts` (DB-backed via `audit_log`, works across
  serverless instances): 5 failed logins/account + 20/IP per 15 min; 5 registrations/IP/hour; failed
  logins audited with hashed IPs. New passwords ≥ 10 characters.
- **Security headers** — `next.config.mjs`: CSP (self + CARTO/OSM tiles + Google Fonts, blob workers,
  `frame-ancestors 'none'`), X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy, HSTS.
- **Tenant privacy** — private brands (`franchisor.created_by_user_id`), per-intake outlets
  (`outlet.intake_submission_id`), intake versioning limited to the owner; private brands answer 404.
- **No PII in URLs** — the run-report cover details are POSTed (form body), not query params.
- **AI layer** — provider errors never reach the client (short reason codes only); strict
  `AI_PROVIDER`; per-site generation lock (no double-billing); PDF/status GETs never trigger a paid
  call; post-generation check that every number traces to the data + no price-verdict wording
  (`lib/ai/outputCheck.ts`, warns on the Analysis tab and PDF).
- **Repo hygiene** — `bsa_dev.dump` (contained password hashes) removed from git history; `*.dump`
  ignored.

## Open items for the dev team (flagged, not hidden)

1. **Rotate the Google API key** that shipped in the intake `keys.docx` — treat as compromised; issue a
   fresh key restricted by API + referrer. (Google features are currently off: `PLACES_LIVE` unset.)
2. **Rotate passwords of real accounts** that existed when `bsa_dev.dump` was public on GitHub.
3. **Nonce-based CSP.** `script-src` still needs `'unsafe-inline'` for Next 14 bootstrap scripts; move to
   nonces via middleware.
4. **Session revocation.** JWTs are stateless (8 h); logout/password change don't revoke other sessions.
   Add a token version on `app_user` or a server-side session table.
5. **Object storage.** Reports are rebuilt on demand (no files stored). `lib/storage` + `/api/files`
   (signed URLs) remain for a future S3/R2 adapter — needed only if file uploads/archives return.
6. **Edge rate limiting.** The DB-backed limiter is sufficient for the prototype; production should add
   a WAF / edge limiter in front of `/api/auth/*`.
7. **CSRF.** SameSite=Lax covers the current endpoints; add explicit tokens if any state-changing
   endpoint is ever exposed cross-site.
8. **Dependency scanning** in CI (`npm audit` / Dependabot) before production.

## Non-negotiables to keep

API-first (browser never holds a secret or hits the DB), Truth Layer structural, zonal
values as tax-reference floors only (never a market-price verdict), broker-supplementation
framing in user-facing copy.
