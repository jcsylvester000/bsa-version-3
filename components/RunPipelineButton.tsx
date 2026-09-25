'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-runs the deterministic pipeline for a run from scratch (e.g. after reference data was
 * updated), then refreshes the page. The recommendation on each site's Final Report is computed
 * live from the refreshed module results — there is no separate write step.
 *
 * The first POST sends `{ refresh: true }` (recompute every site); later POSTs resume the
 * time-boxed slices until the server reports `complete`.
 */
export function RunPipelineButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  async function run() {
    setState('running');
    try {
      for (let i = 0; i < 30; i++) {
        const res = await fetch(`/api/runs/${runId}/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(i === 0 ? { refresh: true } : {}),
        });
        const json = await res.json().catch(() => null);
        if (!json?.ok) { setState('error'); router.refresh(); return; }
        if (json.data?.complete !== false) break;
      }
      setState('done');
      router.refresh();
    } catch {
      setState('error');
    }
  }

  return (
    <button
      onClick={run}
      disabled={state === 'running'}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink-bg shadow hover:opacity-90 disabled:opacity-50"
      title="Recompute every module for every site in this run with the latest data"
    >
      {state === 'running' ? '⏳ Analysing sites…' : state === 'error' ? '↻ Retry' : '↻ Re-run analysis'}
    </button>
  );
}
