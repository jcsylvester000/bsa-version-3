'use client';

/**
 * Capture Coverage → "User demand" + "Automatic back-fill" (2026-10-09).
 *
 *   User demand      what users searched for and where they placed intake sites, with the place data
 *                    BSA had there at that moment (covered / partial / gap) and the job it started.
 *   Automatic        the back-fill queue worked every 10 minutes (and on "Run now"): each job fills the
 *   back-fill        missing layers for a ~1 km area, saves new places (Verified), and refreshes the
 *                    analyses that were waiting for them.
 *
 * Personal data (RA 10173): admins only; no IP or device data is kept; rows are purged after 12 months.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ALL_LAYERS } from '@/lib/capture/layers';
import { manilaShortStampYear } from '@/lib/util/manilaTime';

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
async function api<T>(url: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    try { return (await res.json()) as ApiResult<T>; } catch { return { ok: false, error: { code: `http_${res.status}`, message: `The server answered ${res.status}.` } }; }
  } catch {
    return { ok: false, error: { code: 'network', message: 'Network error — check your connection and try again.' } };
  }
}
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface DemandItem {
  id: string; kind: 'search' | 'intake_site'; user: string | null; query: string | null; label: string | null; lat: number; lon: number;
  barangay: string | null; city: string | null; province: string | null; region: string | null; vertical: string | null; runId: string | null;
  placesNearby: number; coverageStatus: 'covered' | 'partial' | 'gap'; fillJobId: string | null; jobStatus: string | null; createdAt: string;
}
interface DemandData { days: number; totals: { searches: number; sites: number; gaps: number; partial: number; users: number }; items: DemandItem[] }
interface Job {
  id: string; label: string; lat: number; lon: number; radiusM: number; layers: string[]; layersDone: string[]; layersFailed: string[];
  status: string; reason: string; demandCount: number; runs: number; attempts: number; nextAttemptAt: string; placesSaved: number;
  lastError: string | null; createdAt: string; finishedAt: string | null;
}
interface FillData { enabled: boolean; dailyCap: number; scheduled: boolean; usage: { today: number; queued: number; waiting_runs: number; saved_30d: number }; jobs: Job[] }
interface RunSummary { skipped?: string; job?: { label: string; status: string; layersDone: string[]; layersFailed: string[]; saved: number; boundaries: number }; refreshed: Array<{ runId: string; state: string }>; ms: number }

const LAYER_LABEL: Record<string, string> = Object.fromEntries(ALL_LAYERS.map((l) => [l.key, l.label]));
const layerName = (k: string) => LAYER_LABEL[k] ?? k;
const stamp = (iso: string) => manilaShortStampYear(new Date(iso));
const where = (d: { barangay: string | null; city: string | null; province: string | null }) =>
  [d.barangay ? `Brgy ${d.barangay}` : null, d.city, d.province].filter(Boolean).join(', ') || 'No boundary loaded';
const STATUS_TONE: Record<string, string> = { covered: 'text-go', partial: 'text-caution', gap: 'text-nogo' };
const STATUS_TEXT: Record<string, string> = { covered: '✓ Covered', partial: '▲ Partial', gap: '✕ No data' };
const JOB_TEXT: Record<string, string> = { queued: '◌ Queued', running: '… Running', done: '✓ Done', partial: '▲ Partly done', failed: '✕ Failed', cancelled: 'Cancelled' };
const JOB_TONE: Record<string, string> = { queued: 'text-caution', running: 'text-caution', done: 'text-go', partial: 'text-caution', failed: 'text-nogo', cancelled: 'text-ink-muted' };

export function DemandPanel({ onPoints, onFocus }: { onPoints?: (items: DemandItem[]) => void; onFocus?: (lat: number, lon: number) => void }) {
  const [demand, setDemand] = useState<DemandData | null>(null);
  const [fill, setFill] = useState<FillData | null>(null);
  const [days, setDays] = useState(30);
  const [view, setView] = useState<'gaps' | 'all' | 'search' | 'intake_site'>('gaps');
  const [jobView, setJobView] = useState<'open' | 'all'>('open');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    const [d, f] = await Promise.all([api<DemandData>(`/api/admin/capture/demand?days=${days}`), api<FillData>('/api/admin/capture/autofill')]);
    if (d.ok) { setDemand(d.data); onPoints?.(d.data.items); } else setMsg({ tone: 'err', text: d.error.message });
    if (f.ok) setFill(f.data);
  }, [days, onPoints]);
  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => (demand?.items ?? []).filter((i) => view === 'all' ? true : view === 'gaps' ? i.coverageStatus !== 'covered' : i.kind === view), [demand, view]);
  const jobs = useMemo(() => (fill?.jobs ?? []).filter((j) => jobView === 'all' || j.status === 'queued' || j.status === 'running'), [fill, jobView]);

  async function act(key: string, body: unknown, ok: (d: unknown) => string) {
    setBusy(key); setMsg(null);
    const r = await api<unknown>('/api/admin/capture/autofill', post(body));
    setBusy(null);
    if (!r.ok) { setMsg({ tone: 'err', text: r.error.message }); return; }
    setMsg({ tone: 'ok', text: ok(r.data) });
    await load();
  }
  const runNow = () => act('run', { action: 'run' }, (d) => {
    const s = d as RunSummary;
    if (s.skipped && !s.refreshed.length) return `Nothing fetched: ${s.skipped}.`;
    const parts = [];
    if (s.job) parts.push(`“${s.job.label}”: ${JOB_TEXT[s.job.status] ?? s.job.status} — ${s.job.layersDone.length} layer(s) filled, ${s.job.saved} new place(s)${s.job.layersFailed.length ? `, ${s.job.layersFailed.length} layer(s) will retry` : ''}${s.job.boundaries ? `, ${s.job.boundaries} barangay boundaries loaded` : ''}`);
    else if (!s.skipped) parts.push('No job was due');
    if (s.refreshed.length) parts.push(`${s.refreshed.filter((r) => r.state === 'done').length} waiting analysis(es) refreshed`);
    return `${parts.join(' · ')} (${(s.ms / 1000).toFixed(1)} s).`;
  });

  const t = demand?.totals;
  return (
    <>
      <section id="demand" className="card scroll-mt-4 overflow-hidden" aria-labelledby="dm-h">
        <div className="flex flex-wrap items-end justify-between gap-3 px-5 py-4">
          <div>
            <h2 id="dm-h" className="font-body text-title">User demand</h2>
            <p className="text-label font-normal text-ink-muted">
              What users searched for and where they placed intake sites — and whether BSA had place data there at that moment. Intake sites in a gap start a back-fill automatically; searches can be queued from here.
            </p>
          </div>
          <label className="text-label"><span className="field-label">Period</span>
            <select className="field mt-1 min-h-[38px] py-1" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={365}>Last 12 months</option>
            </select>
          </label>
        </div>
        <dl className="grid grid-cols-2 gap-3 border-t border-ink-border px-5 py-3 sm:grid-cols-5">
          <div><dt className="stat-label">Searches</dt><dd className="text-h3">{t ? t.searches : '—'}</dd></div>
          <div><dt className="stat-label">Intake sites</dt><dd className="text-h3">{t ? t.sites : '—'}</dd></div>
          <div><dt className="stat-label">In a gap (no data)</dt><dd className={`text-h3 ${t?.gaps ? 'text-nogo' : ''}`}>{t ? t.gaps : '—'}</dd></div>
          <div><dt className="stat-label">Partial data</dt><dd className={`text-h3 ${t?.partial ? 'text-caution' : ''}`}>{t ? t.partial : '—'}</dd></div>
          <div><dt className="stat-label">Users</dt><dd className="text-h3">{t ? t.users : '—'}</dd></div>
        </dl>
        <div className="flex flex-wrap gap-1 border-t border-ink-border px-5 py-2" role="tablist">
          {([['gaps', 'Needs data'], ['all', 'All'], ['search', 'Searches'], ['intake_site', 'Intake sites']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)}
              className={`rounded-full border px-3 py-1 text-label ${view === k ? 'border-accent-soft bg-ink-hover text-ink-text' : 'border-ink-border text-ink-muted'}`}>{l}</button>
          ))}
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-label">
            <thead className="sticky top-0 bg-ink-panel text-ink-muted"><tr>
              <th className="px-5 py-2 text-left font-normal">When · who</th><th className="text-left font-normal">Looked for</th><th className="text-left font-normal">Where</th>
              <th className="text-right font-normal">Places then</th><th className="px-3 text-left font-normal">Data</th><th className="px-5 text-right font-normal">Back-fill</th>
            </tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id} className="border-t border-ink-border align-top">
                  <td className="whitespace-nowrap px-5 py-2">{stamp(i.createdAt)}<span className="block text-ink-muted">{i.user ?? '—'}</span></td>
                  <td className="py-2 pr-3">
                    <span className="text-ink-text">{i.kind === 'search' ? `“${i.query ?? ''}”` : i.label ?? 'Intake site'}</span>
                    <span className="block text-ink-muted">{i.kind === 'search' ? 'Address search' : `Intake site${i.vertical ? ` · ${layerName(`v:${i.vertical}`)}` : ''}`}</span>
                  </td>
                  <td className="py-2 pr-3"><button type="button" className="text-left" onClick={() => onFocus?.(i.lat, i.lon)}>{where(i)}<span className="block text-ink-muted">{i.lat.toFixed(5)}, {i.lon.toFixed(5)}</span></button></td>
                  <td className="py-2 text-right">{i.placesNearby}</td>
                  <td className={`px-3 py-2 ${STATUS_TONE[i.coverageStatus]}`}>{STATUS_TEXT[i.coverageStatus]}</td>
                  <td className="whitespace-nowrap px-5 py-2 text-right">
                    {i.fillJobId
                      ? <span className={JOB_TONE[i.jobStatus ?? ''] ?? ''}>{JOB_TEXT[i.jobStatus ?? ''] ?? i.jobStatus}</span>
                      : i.coverageStatus !== 'covered'
                        ? <button type="button" className="link" disabled={!!busy} onClick={() => act(`q${i.id}`, { action: 'queue', demandId: i.id }, (d) => ((d as { alreadyCovered?: boolean }).alreadyCovered ? 'Already covered now — nothing to queue.' : 'Queued for the automatic back-fill.'))}>Queue back-fill</button>
                        : <span className="text-ink-muted">—</span>}
                    <a className="link ml-3" href={`/admin/capture?lat=${i.lat.toFixed(6)}&lon=${i.lon.toFixed(6)}`}>Capture</a>
                  </td>
                </tr>
              ))}
              {!items.length && <tr><td colSpan={6} className="px-5 py-4 text-ink-muted">{demand ? (view === 'gaps' ? '✓ Every request in this period landed where BSA has place data.' : 'Nothing in this period.') : 'Loading…'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section id="autofill" className="card scroll-mt-4 overflow-hidden" aria-labelledby="af-h">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
          <div className="max-w-3xl">
            <h2 id="af-h" className="font-body text-title">Automatic back-fill</h2>
            <p className="text-label font-normal text-ink-muted">
              Fills the missing place layers around requested areas from OpenStreetMap — one job at a time, only when OpenStreetMap has a free slot, at most {fill?.dailyCap ?? 30} jobs a day — using the same pipeline as Place Capture (Verified places, new only, retry list for misses). Analyses waiting on an area are recomputed when its job finishes.
            </p>
            {fill && (
              <p className="mt-1 text-label">
                {fill.enabled ? <span className="text-go">✓ On</span> : <span className="text-nogo">✕ Off (AUTOFILL_ENABLED=0 or OSM_LIVE=0)</span>}
                {' · '}{fill.scheduled ? 'runs every 10 minutes' : <span className="text-caution">schedule not set up (CRON_SECRET) — use Run now</span>}
                {' · '}{fill.usage.today} of {fill.dailyCap} jobs in the last 24 h · {fill.usage.queued} queued · {fill.usage.waiting_runs} analysis(es) waiting · {fill.usage.saved_30d} places added in 30 days
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={() => void load()} disabled={!!busy}>Refresh</button>
            <button type="button" className="btn-primary" onClick={runNow} disabled={!!busy || (fill ? !fill.enabled : true)}>{busy === 'run' ? 'Running… (up to 25 s)' : 'Run now'}</button>
          </div>
        </div>
        {msg && <p role="status" className={`border-t border-ink-border px-5 py-2 text-label font-normal ${msg.tone === 'err' ? 'text-nogo' : 'text-ink-text'}`}>{msg.tone === 'err' ? '✕ ' : '✓ '}{msg.text}</p>}
        <div className="flex gap-1 border-t border-ink-border px-5 py-2" role="tablist">
          {([['open', `Open (${(fill?.jobs ?? []).filter((j) => j.status === 'queued' || j.status === 'running').length})`], ['all', 'All']] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={jobView === k} onClick={() => setJobView(k)}
              className={`rounded-full border px-3 py-1 text-label ${jobView === k ? 'border-accent-soft bg-ink-hover text-ink-text' : 'border-ink-border text-ink-muted'}`}>{l}</button>
          ))}
        </div>
        <div className="max-h-[420px] overflow-auto">
          <table className="w-full text-label">
            <thead className="sticky top-0 bg-ink-panel text-ink-muted"><tr>
              <th className="px-5 py-2 text-left font-normal">Area</th><th className="text-left font-normal">Layers</th><th className="text-right font-normal">Requests</th>
              <th className="text-right font-normal">New places</th><th className="px-3 text-left font-normal">Status</th><th className="px-5 text-right font-normal">Action</th>
            </tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} className="border-t border-ink-border align-top">
                  <td className="py-2 pl-5 pr-3"><button type="button" className="text-left" onClick={() => onFocus?.(j.lat, j.lon)}><span className="text-ink-text">{j.label}</span><span className="block text-ink-muted">{j.radiusM.toLocaleString('en-US')} m ring · {j.reason === 'intake' ? 'from an intake' : j.reason === 'search' ? 'from a search' : 'queued by an admin'} · {stamp(j.createdAt)}</span></button></td>
                  <td className="py-2 pr-3">
                    <ul className="flex flex-wrap gap-1">
                      {j.layers.map((l) => {
                        const done = j.layersDone.includes(l), failed = j.layersFailed.includes(l);
                        return <li key={l} className={`rounded-full border px-2 py-0.5 text-[12px] ${done ? 'border-go text-go' : failed ? 'border-nogo text-nogo' : 'border-ink-border text-ink-muted'}`}>{done ? '✓ ' : failed ? '✕ ' : '· '}{layerName(l)}</li>;
                      })}
                    </ul>
                  </td>
                  <td className="py-2 text-right">{j.demandCount}{j.runs ? <span className="block text-ink-muted">{j.runs} analysis(es)</span> : null}</td>
                  <td className="py-2 text-right">{j.placesSaved}</td>
                  <td className={`px-3 py-2 ${JOB_TONE[j.status] ?? ''}`}>
                    {JOB_TEXT[j.status] ?? j.status}
                    {j.status === 'queued' && new Date(j.nextAttemptAt).getTime() > Date.now() && <span className="block text-ink-muted">retry {stamp(j.nextAttemptAt)} (try {j.attempts + 1} of 3)</span>}
                    {j.lastError && j.status !== 'done' && <span className="block text-ink-muted" title={j.lastError}>{j.lastError.slice(0, 60)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-5 py-2 text-right">
                    {(j.status === 'queued' || j.status === 'running') && <button type="button" className="link" disabled={!!busy} onClick={() => act(`c${j.id}`, { action: 'cancel', jobId: j.id }, () => 'Job cancelled.')}>Cancel</button>}
                    {(j.status === 'partial' || j.status === 'failed' || j.status === 'cancelled') && <button type="button" className="link" disabled={!!busy} onClick={() => act(`r${j.id}`, { action: 'retry', jobId: j.id }, () => 'Job queued again.')}>Retry</button>}
                    <a className="link ml-3" href={`/admin/capture?lat=${j.lat.toFixed(6)}&lon=${j.lon.toFixed(6)}`}>Capture by hand</a>
                  </td>
                </tr>
              ))}
              {!jobs.length && <tr><td colSpan={6} className="px-5 py-4 text-ink-muted">{fill ? (jobView === 'open' ? '✓ Nothing waiting — every requested area has been filled.' : 'No back-fill jobs yet.') : 'Loading…'}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
