'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Runs the deterministic pipeline for a run, then refreshes so the new status,
 * confidence, and per-site verdicts show. AI is not involved — this is the
 * deterministic compute step; the report composer phrases later.
 */
export function RunPipelineButton({ runId }: { runId: string }) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');

  async function run() {
    setState('running');
    const res = await fetch(`/api/runs/${runId}/run`, { method: 'POST' });
    const json = await res.json();
    if (!json.ok) {
      setState('error');
      return;
    }
    setState('done');
    router.refresh();
  }

  return (
    <button
      onClick={run}
      disabled={state === 'running'}
      className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-ink-bg shadow hover:opacity-90 disabled:opacity-50"
      title="Run the deterministic pipeline (site fit, territory, lease) for this run"
    >
      {state === 'running' ? '⏳ Running…' : state === 'error' ? '↻ Retry run' : '▶ Run pipeline'}
    </button>
  );
}
