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

## Open items for the dev team (flagged, not hidden)

1. **Rotate the Google API key** that shipped in the intake `keys.docx` — it was exposed in
   a document. Treat as compromised; issue a fresh key and restrict it by API + referrer.
2. **Object storage + signed URLs.** Report/intake file storage is specified but not yet
   wired (S3/R2). Until then reports are metadata-only. No public buckets — use signed URLs.
3. **Rate limiting / brute-force protection** on `/api/auth/login` is not yet added.
4. **CSRF.** SameSite=Lax mitigates the common case for the cookie; add explicit CSRF
   tokens if any state-changing endpoint is ever exposed cross-site.
5. **Real AI provider review.** When `AI_PROVIDER` is switched from `stub` to a live model,
   re-review the grounding boundary and add output validation that the model introduced no
   number absent from the grounded facts.
6. **Security headers / CSP.** Add a Content-Security-Policy and standard headers at the
   hosting layer.
7. **Dependency scanning** in CI (e.g. `npm audit` / Dependabot) before production.

## Non-negotiables to keep

API-first (browser never holds a secret or hits the DB), Truth Layer structural, zonal
values as tax-reference floors only (never a market-price verdict), broker-supplementation
framing in user-facing copy.
