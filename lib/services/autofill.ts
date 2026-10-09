/**
 * Automated POI back-fill runner (2026-10-09) — works the poi_fill_job queue safely, then refreshes
 * the analyses that were waiting for the data.
 *
 *   scheduled (every 10 min) / admin "Run now"
 *     1. guard rails: switched on? OpenStreetMap free? daily job cap not reached?
 *     2. claim ONE due job (FOR UPDATE SKIP LOCKED — two runners never take the same job)
 *     3. barangay boundaries for the area (on demand), then each missing layer ONE AT A TIME through the
 *        same capture pipeline admins use (receipts → Verified, new places only, coverage stamped,
 *        failures into the retry queue) — saved as a capture batch "Auto-fill · …" on Capture Coverage
 *     4. failed layers retry with back-off (20 min, 40 min), then the job closes as done / partial / failed
 *     5. runs that were waiting on the area are recomputed (deterministic pipeline, time-sliced)
 *
 * Time-boxed for a serverless call (default 20 s); a job that runs out of time resumes on the next call.
 * No AI is involved and nothing is invented: the refreshed run reads only the places that were saved.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import type { SessionUser } from '@/lib/auth/auth';
import { previewArea, saveCapture, type SaveInput } from '@/lib/services/capture';
import { loadBoundariesForArea } from '@/lib/geo/boundaryOnDemand';
import { overpassStatus } from '@/lib/places/osmService';
import { osmLiveEnabled } from '@/lib/places/poiCache';
import { runPipeline } from '@/lib/modules/orchestrator';
import { audit } from '@/lib/audit/audit';
import type { LayerKey } from '@/lib/capture/layers';

/** The back-fill acts as a system admin (no user id; audit rows show actor = null, meta.auto = true). */
export const AUTOFILL_ACTOR: SessionUser = { id: 'system-autofill', email: 'autofill@bsa.system', role: 'admin', franchisorId: null } as SessionUser;
export const MAX_FILL_ATTEMPTS = 3;
const RETRY_BASE_MIN = 20;
const STALE_RUNNING_MIN = 10;
const MIN_LAYER_MS = 7_000;

export function autofillEnabled(): boolean {
  const v = (process.env.AUTOFILL_ENABLED ?? '1').toLowerCase();
  return osmLiveEnabled() && !['0', 'false', 'off', 'no'].includes(v);
}
export function autofillDailyCap(): number {
  const n = Number(process.env.AUTOFILL_DAILY_JOBS ?? 30);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 30;
}

/** Back-off before a job's failed layers are tried again: 20 min, then 40 min. Pure (unit-tested). */
export function retryDelayMs(attempts: number): number {
  return RETRY_BASE_MIN * 60_000 * 2 ** Math.max(0, attempts - 1);
}

/** Final status once no layer is left to try. Pure (unit-tested). */
export function finalStatus(done: number, failed: number): 'done' | 'partial' | 'failed' {
  if (failed === 0) return 'done';
  return done > 0 ? 'partial' : 'failed';
}

interface JobRow {
  id: string; label: string; lat: number; lon: number; radius_m: number; layers: string[]; layers_done: string[];
  layers_failed: string[]; attempts: number; run_ids: string[]; places_saved: number;
}

export interface AutofillSummary {
  skipped?: string;
  job?: { id: string; label: string; status: string; layersDone: string[]; layersFailed: string[]; saved: number; boundaries: number };
  refreshed: Array<{ runId: string; state: string }>;
  ms: number;
}

/** One time-boxed pass of the queue + the waiting runs. Never throws (errors land on the job). */
export async function runAutofill(opts: { budgetMs?: number; trigger: 'cron' | 'admin'; actorId?: string | null } = { trigger: 'cron' }): Promise<AutofillSummary> {
  const t0 = Date.now();
  const deadline = t0 + Math.min(Math.max(opts.budgetMs ?? 20_000, 8_000), 25_000);
  const summary: AutofillSummary = { refreshed: [], ms: 0 };

  // A runner that died mid-job (timeout, deploy) leaves it "running" — hand it back to the queue.
  await prisma.$executeRaw`
    UPDATE poi_fill_job SET status = 'queued'
    WHERE status = 'running' AND started_at < now() - make_interval(mins => ${STALE_RUNNING_MIN})`;

  const skip = await fetchGuard();
  if (skip) summary.skipped = skip;
  else {
    const job = await claimJob();
    if (job) summary.job = await workJob(job, deadline);
  }

  // Refresh phase runs even when fetching is paused, so finished data always reaches the reports.
  summary.refreshed = await refreshWaitingRuns(deadline);
  summary.ms = Date.now() - t0;
  if (summary.job || summary.refreshed.length) {
    await audit({ actorId: opts.actorId ?? null, action: 'poi.autofill.run', entity: 'poi_fill_job', entityId: summary.job?.id ?? null, meta: { trigger: opts.trigger, ...summary, auto: true } });
  }
  return summary;
}

async function fetchGuard(): Promise<string | null> {
  if (!autofillEnabled()) return 'disabled (AUTOFILL_ENABLED=0 or OSM_LIVE=0)';
  const used = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(*)::int AS n FROM poi_fill_job WHERE started_at >= now() - interval '24 hours'`;
  if ((used[0]?.n ?? 0) >= autofillDailyCap()) return `daily cap reached (${autofillDailyCap()} jobs / 24 h)`;
  const st = await overpassStatus();
  if (st.reachable && st.waitSeconds > 15) return `OpenStreetMap busy (next slot in ${st.waitSeconds} s)`;
  return null;
}

async function claimJob(): Promise<JobRow | null> {
  const rows = await prisma.$queryRaw<JobRow[]>`
    UPDATE poi_fill_job SET status = 'running', started_at = COALESCE(started_at, now())
    WHERE id = (
      SELECT id FROM poi_fill_job
      WHERE status = 'queued' AND next_attempt_at <= now()
      ORDER BY demand_count DESC, created_at ASC
      LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id::text, label, lat, lon, radius_m, layers, layers_done, layers_failed, attempts, run_ids::text[] AS run_ids, places_saved`;
  return rows[0] ?? null;
}

async function workJob(job: JobRow, deadline: number): Promise<NonNullable<AutofillSummary['job']>> {
  const area = { kind: 'circle' as const, lat: job.lat, lon: job.lon, radiusM: job.radius_m };
  let boundaries = 0;
  try { boundaries = (await loadBoundariesForArea(area)).barangaysLoaded; } catch (e) { console.error('[autofill] boundaries', e); }

  const todo = job.layers.filter((l) => !job.layers_done.includes(l));
  const done: string[] = [], failed: string[] = [], fetched: string[] = [];
  const items: SaveInput['items'] = [];
  let lastError: string | null = null;
  for (const layer of todo) {
    const left = deadline - Date.now();
    if (left < MIN_LAYER_MS) break; // resume next call
    try {
      const r = await previewArea(AUTOFILL_ACTOR, {
        area, layers: [layer as LayerKey], label: `Auto-fill · ${job.label}`, budgetMs: Math.min(15_000, left - 4_000),
      });
      const lr = r.layers[0];
      if (lr?.status === 'covered') done.push(layer);
      else if (lr?.status === 'loaded' && !lr.truncated) { done.push(layer); fetched.push(layer); }
      else { failed.push(layer); lastError = lr?.message ?? 'failed'; }
      for (const c of r.candidates) {
        items.push({ osmRef: c.osmRef, receipt: c.receipt ?? null, name: c.name, kind: c.kind, category: c.category, lat: c.lat, lon: c.lon, origin: 'osm', notes: null });
      }
    } catch (e) {
      failed.push(layer);
      lastError = e instanceof Error ? e.message.slice(0, 200) : 'error';
    }
  }

  let saved = 0;
  if (items.length || fetched.length) {
    try {
      const r = await saveCapture(AUTOFILL_ACTOR, {
        source: 'osm', label: `Auto-fill · ${job.label}`, area, layers: [...done, ...failed] as LayerKey[], fetchedLayers: fetched as LayerKey[],
        context: { site: { lat: job.lat, lon: job.lon } }, items,
      });
      saved = r.saved;
    } catch (e) {
      // Nothing was stored for these layers — try them again later.
      lastError = e instanceof Error ? e.message.slice(0, 200) : 'save failed';
      failed.push(...fetched);
      done.splice(0, done.length, ...done.filter((l) => !fetched.includes(l)));
    }
  }

  const layersDone = [...new Set([...job.layers_done, ...done])];
  const remaining = job.layers.filter((l) => !layersDone.includes(l) && !failed.includes(l));
  let status: string;
  if (remaining.length) {
    // Ran out of time: keep going on the next call (failed layers wait for their back-off round).
    status = 'queued';
    await prisma.$executeRaw`
      UPDATE poi_fill_job SET status = 'queued', layers_done = ${layersDone}::text[], layers_failed = ${failed}::text[],
        places_saved = places_saved + ${saved}, last_error = ${lastError}, next_attempt_at = now()
      WHERE id = ${job.id}::uuid`;
  } else if (failed.length && job.attempts + 1 < MAX_FILL_ATTEMPTS) {
    status = 'queued';
    const next = new Date(Date.now() + retryDelayMs(job.attempts + 1));
    await prisma.$executeRaw`
      UPDATE poi_fill_job SET status = 'queued', attempts = attempts + 1, layers_done = ${layersDone}::text[], layers_failed = ${failed}::text[],
        places_saved = places_saved + ${saved}, last_error = ${lastError}, next_attempt_at = ${next}
      WHERE id = ${job.id}::uuid`;
    // Some layers landed but others wait 20–40 min for their back-off round: don't keep the broker
    // waiting for the whole job — recompute now with what arrived; the final round recomputes again.
    if (saved > 0) await markPartialData(job.run_ids);
  } else {
    status = finalStatus(layersDone.length, failed.length);
    await prisma.$executeRaw`
      UPDATE poi_fill_job SET status = ${status}::"FillJobStatus", attempts = attempts + ${failed.length ? 1 : 0},
        layers_done = ${layersDone}::text[], layers_failed = ${failed}::text[], places_saved = places_saved + ${saved},
        last_error = ${failed.length ? lastError : null}, finished_at = now()
      WHERE id = ${job.id}::uuid`;
    // Only claim "updated with new place data" when this area actually gained places.
    await releaseRuns(job.id, job.run_ids, job.places_saved + saved > 0 ? 'data' : 'none');
  }
  return { id: job.id, label: job.label, status, layersDone, layersFailed: failed, saved, boundaries };
}

/**
 * A finished job hands its runs on — unless another open job still covers them:
 *   'data'  places were added → the run is recomputed ('due');
 *   'none'  nothing could be collected (failed / cancelled) → a waiting run is told so ('unavailable'),
 *           a run another job already marked 'due' keeps its refresh.
 */
async function releaseRuns(jobId: string, runIds: string[], outcome: 'data' | 'none'): Promise<void> {
  if (!runIds.length) return;
  if (outcome === 'data') {
    await prisma.$executeRaw`
      UPDATE pipeline_run r SET data_refresh_state = 'due'
      WHERE r.id = ANY(${runIds}::uuid[]) AND COALESCE(r.data_refresh_state, '') <> 'running'
        AND NOT EXISTS (SELECT 1 FROM poi_fill_job j WHERE j.id <> ${jobId}::uuid AND j.status IN ('queued', 'running') AND r.id = ANY(j.run_ids))`;
  } else {
    await prisma.$executeRaw`
      UPDATE pipeline_run r SET data_refresh_state = 'unavailable'
      WHERE r.id = ANY(${runIds}::uuid[]) AND r.data_refresh_state = 'waiting'
        AND NOT EXISTS (SELECT 1 FROM poi_fill_job j WHERE j.id <> ${jobId}::uuid AND j.status IN ('queued', 'running') AND r.id = ANY(j.run_ids))`;
  }
}

/** Runs still 'waiting' on a job that has already saved some places → recompute them now. */
async function markPartialData(runIds: string[]): Promise<void> {
  if (!runIds.length) return;
  await prisma.$executeRaw`
    UPDATE pipeline_run SET data_refresh_state = 'due'
    WHERE id = ANY(${runIds}::uuid[]) AND data_refresh_state = 'waiting'`;
}

/** Recompute runs whose area data has arrived (time-sliced, resumable). */
async function refreshWaitingRuns(deadline: number): Promise<AutofillSummary['refreshed']> {
  const out: AutofillSummary['refreshed'] = [];
  while (deadline - Date.now() > 6_000) {
    const runs = await prisma.$queryRaw<Array<{ id: string; state: string }>>`
      SELECT id::text, data_refresh_state AS state FROM pipeline_run
      WHERE data_refresh_state IN ('due', 'running') ORDER BY data_pending_at ASC NULLS LAST LIMIT 1`;
    const run = runs[0];
    if (!run) break;
    try {
      let first = run.state === 'due';
      if (first) await prisma.$executeRaw`UPDATE pipeline_run SET data_refresh_state = 'running' WHERE id = ${run.id}::uuid`;
      let complete = false;
      while (!complete && deadline - Date.now() > 6_000) {
        const r = await runPipeline(run.id, { refresh: first });
        first = false;
        complete = r.complete || r.status === 'failed';
      }
      if (complete) {
        // A partial refresh (a job still has layers in back-off) goes back to 'waiting' — the note then
        // says "partly updated" and the final round recomputes again.
        const st = await prisma.$queryRaw<Array<{ state: string }>>`
          UPDATE pipeline_run r SET data_refreshed_at = now(), data_refresh_state =
            CASE WHEN EXISTS (SELECT 1 FROM poi_fill_job j WHERE j.status IN ('queued', 'running') AND r.id = ANY(j.run_ids)) THEN 'waiting' ELSE 'done' END
          WHERE r.id = ${run.id}::uuid RETURNING r.data_refresh_state AS state`;
        out.push({ runId: run.id, state: st[0]?.state ?? 'done' });
      } else {
        out.push({ runId: run.id, state: 'running' });
        break;
      }
    } catch (e) {
      console.error('[autofill] refresh failed', run.id, e);
      // Leave it to the user's own re-run; don't retry a broken run forever.
      await prisma.$executeRaw`UPDATE pipeline_run SET data_refresh_state = 'done' WHERE id = ${run.id}::uuid`;
      out.push({ runId: run.id, state: 'error' });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ admin side */

export async function autofillOverview() {
  const jobs = await prisma.$queryRaw<Array<{
    id: string; label: string; lat: number; lon: number; radius_m: number; layers: string[]; layers_done: string[]; layers_failed: string[];
    status: string; reason: string; demand_count: number; runs: number; attempts: number; next_attempt_at: Date; places_saved: number;
    last_error: string | null; created_at: Date; finished_at: Date | null;
  }>>`
    SELECT id::text, label, lat, lon, radius_m, layers, layers_done, layers_failed, status::text, reason, demand_count,
           COALESCE(array_length(run_ids, 1), 0)::int AS runs, attempts, next_attempt_at, places_saved, last_error, created_at, finished_at
    FROM poi_fill_job
    ORDER BY (status IN ('queued', 'running')) DESC, demand_count DESC, created_at DESC
    LIMIT 300`;
  const usage = await prisma.$queryRaw<Array<{ today: number; queued: number; waiting_runs: number; saved_30d: number }>>`
    SELECT (SELECT COUNT(*)::int FROM poi_fill_job WHERE started_at >= now() - interval '24 hours') AS today,
           (SELECT COUNT(*)::int FROM poi_fill_job WHERE status IN ('queued', 'running')) AS queued,
           (SELECT COUNT(*)::int FROM pipeline_run WHERE data_refresh_state IN ('waiting', 'due', 'running')) AS waiting_runs,
           (SELECT COALESCE(SUM(places_saved), 0)::int FROM poi_fill_job WHERE created_at >= now() - interval '30 days') AS saved_30d`;
  return {
    enabled: autofillEnabled(),
    dailyCap: autofillDailyCap(),
    scheduled: !!process.env.CRON_SECRET,
    usage: usage[0] ?? { today: 0, queued: 0, waiting_runs: 0, saved_30d: 0 },
    jobs: jobs.map((j) => ({
      id: j.id, label: j.label, lat: j.lat, lon: j.lon, radiusM: j.radius_m, layers: j.layers, layersDone: j.layers_done, layersFailed: j.layers_failed,
      status: j.status, reason: j.reason, demandCount: j.demand_count, runs: j.runs, attempts: j.attempts, nextAttemptAt: j.next_attempt_at,
      placesSaved: j.places_saved, lastError: j.last_error, createdAt: j.created_at, finishedAt: j.finished_at,
    })),
  };
}

export async function setJobStatus(jobId: string, action: 'cancel' | 'retry'): Promise<boolean> {
  const n = action === 'cancel'
    ? await prisma.$executeRaw`UPDATE poi_fill_job SET status = 'cancelled', finished_at = now() WHERE id = ${jobId}::uuid AND status IN ('queued', 'running')`
    : await prisma.$executeRaw`
        UPDATE poi_fill_job j SET status = 'queued', attempts = 0, layers_failed = ARRAY[]::text[], next_attempt_at = now(), finished_at = NULL
        WHERE j.id = ${jobId}::uuid AND j.status IN ('partial', 'failed', 'cancelled')
          AND NOT EXISTS (SELECT 1 FROM poi_fill_job o WHERE o.area_key = j.area_key AND o.status IN ('queued', 'running'))`;
  if (n && action === 'cancel') {
    const r = await prisma.poiFillJob.findUnique({ where: { id: jobId }, select: { runIds: true, placesSaved: true } });
    if (r) await releaseRuns(jobId, r.runIds, r.placesSaved > 0 ? 'data' : 'none');
  }
  if (n && action === 'retry') {
    // Runs that were told "unavailable" are waiting again.
    await prisma.$executeRaw`
      UPDATE pipeline_run r SET data_refresh_state = 'waiting'
      FROM poi_fill_job j WHERE j.id = ${jobId}::uuid AND r.id = ANY(j.run_ids) AND r.data_refresh_state = 'unavailable'`;
  }
  return n > 0;
}
