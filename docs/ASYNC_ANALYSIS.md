# Async Analysis Report (polling + Netlify Background Function)

Removes the timeout ceiling on the AI Analysis Report. A live VectorShift run can take longer than a
synchronous serverless function is allowed to live (Netlify caps sync functions at 26s), which showed
up as `timeout` 502s under load. The generation now runs **off-request** in a Netlify **Background
Function** (up to 15 min); the browser **polls** a read-only status endpoint until the report is ready.

## Flow

```
POST /api/analysis-report        browser                 GET /api/analysis-report        Netlify BG fn
  (start)                          poll every 4s            (read-only status)             analysis-report-background
     │                                                                                          │
     ├─ claimAnalysisReport() ── owns the lock ──► enqueueAnalysisJob() ──202──────────────────►│
     └─ returns { status:'generating' } ──► browser polls ──► GET returns generating/ready/error │ executeAnalysisReport()
                                                                     ▲                            │  (retrieve→VectorShift→persist)
                                                                     └──────────── writes ready/failed to the row ◄┘
```

- **Claim** (`claimAnalysisReport`) is fast and does no generation — it returns the cached report,
  `generating` (another attempt holds a fresh lock), the regenerate cap, or `claimed` (this request
  now owns the lock).
- **Execute** (`executeAnalysisReport`) is the slow part (retrieve → VectorShift → persist). It runs
  in the background function on the live path, and **inline** on the stub path or when async is off.
  It never throws: on failure it restores the previous report (regenerate) or writes a `failed`
  marker with the reason, which the poller surfaces.
- The **per-site `module_result` row** is the lock, the cache, and now the failure record
  (`status: ready | generating | failed`). `LOCK_TTL_MS` is 5 min so a slow background run keeps
  reading `generating` rather than `missing`.

## Enabling it (owner)

Async is **OFF by default** — with it off, generation runs inline exactly as before, so deploying
this code changes nothing until you opt in. To turn it on:

1. Set Netlify env vars (Site settings → Environment variables):
   - `ANALYSIS_BACKGROUND = 1`
   - `INTERNAL_JOB_SECRET = <a long random string>` (authenticates the internal invocation)
   - (already set for the live provider: `AI_PROVIDER=vectorshift`, `VECTORSHIFT_API_KEY`,
     `VECTORSHIFT_PIPELINE_ID`)
2. Because the work is now off-request, you can raise the provider timeout well past the old 24s —
   e.g. `VECTORSHIFT_TIMEOUT_MS = 120000` (2 min). The background function's own budget is 15 min.
3. Deploy. Netlify bundles `netlify/functions/analysis-report-background.mts` (esbuild; the `@/*`
   alias resolves via `netlify/functions/tsconfig.json`; Prisma rides along via `netlify.toml`
   `included_files`). Confirm the function appears under the site's **Functions** tab.
4. Generate a report and watch the Network tab: the POST returns `202 generating` immediately, then
   `GET /api/analysis-report?...` polls every 4s and flips to `ready`.

To turn it back off, unset `ANALYSIS_BACKGROUND` (or set it to `0`) — the app reverts to inline
generation with no redeploy of code needed.

## Failure surfacing

`GET` returns `{ status:'error', reason, message }` when the last attempt failed, so the UI stops
polling and shows the reason (`timeout`, `http_401`, `config_*`, `db_migration_pending`, `internal`…)
instead of spinning. Inline failures map to the same reasons via HTTP status (503 config/migration,
502 otherwise).

## Notes for the dev team (handoff)

- This is a prototype-grade async path: the job queue is the DB row + an HTTP invoke of the
  background function. For production scale, consider a real queue (Netlify’s async workloads, SQS, or
  a durable job table with a worker) and a signed job token instead of a shared secret.
- The background function reuses the exact same `executeAnalysisReport`, so there is one code path for
  generation whether it runs inline or off-request.
