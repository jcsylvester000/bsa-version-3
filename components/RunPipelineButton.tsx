'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-runs the deterministic pipeline for a run from scratch (e.g. after reference data was
 * updated), then writes each site's AI analysis, then refreshes the page.
 *
 * The first POST sends `{ refresh: true }` (recompute every site); later POSTs resume the
 * time-boxed slices until the server reports `complete`. AI write-ups are requested ONE site
 * per request afterwards (same pattern as the intake submit) — failures are non-fatal; the
 * Analysis tab offers "Generate analysis".
 */
export function RunPipelineButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'writing' | 'done' | 'error'>('idle');

  async function run() {
    setState('running');
    try {
      let sites: Array<{ siteId: string }> = [];
      for (let i = 0; i < 30; i++) {
        const res = await fetch(`/api/runs/${runId}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(i === 0 ? { refresh: true } : {}),
        });
        const json = await res.json().catch(() => null);
        if (!json?.ok) { setState('error'); router.refresh(); return; }
        if (json.data?.complete !== false) { sites = json.data?.perSite ?? []; break; }
      }
      setState('writing');
      for (const s of sites) {
        await fetch('/api/analysis-report', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId, siteId: s.siteId }),
        }).catch(() => null);
      }
      setState('done');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  const busy = state === 'running' || state === 'writing';
  return (
    <button
      onClick={run}
      disabled={busy}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink-bg shadow hover:opacity-90 disabled:opacity-50"
      title="Recompute every module for every site in this run with the latest data, then rewrite the analyses"
    >
      {state === 'running' ? '⏳ Analysing sites…' : state === 'writing' ? '⏳ Writing analyses…' : state === 'error' ? '↻ Retry' : '↻ Re-run analysis'}
    </button>
  );
}
