'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Version { intakeId: string; version: number; createdAt: string; runId: string | null; status: string | null }

/**
 * Version history strip for a run. Shows every version of this intake's lineage
 * (edit-and-rerun creates new versions), newest first, each linking to its run.
 * Collapses itself when there's only one version.
 */
export function VersionHistory({ intakeId, currentRunId }: { intakeId: string; currentRunId: string }) {
  const [versions, setVersions] = useState<Version[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/intake/${intakeId}`).then((r) => r.json()).then((j) => {
      if (!cancelled && j.ok) setVersions(j.data.versions ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [intakeId]);

  if (!versions || versions.length <= 1) return null;

  return (
    <div className="card p-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">Version history</p>
      <div className="flex flex-wrap gap-2">
        {versions.map((v) => {
          const isCurrent = v.runId === currentRunId;
          const inner = (
            <span className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${isCurrent ? 'bg-accent text-ink-bg' : 'bg-ink-panel-2 text-ink-muted hover:bg-ink-hover'}`}>
              <span className="font-semibold">v{v.version}</span>
              <span>{new Date(v.createdAt).toLocaleString()}</span>
              {isCurrent && <span className="rounded bg-ink-bg/20 px-1 text-[10px]">current</span>}
            </span>
          );
          return v.runId && !isCurrent
            ? <Link key={v.intakeId} href={`/runs?runId=${v.runId}`}>{inner}</Link>
            : <span key={v.intakeId}>{inner}</span>;
        })}
      </div>
    </div>
  );
}
