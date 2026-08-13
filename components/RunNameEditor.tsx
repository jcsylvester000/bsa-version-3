'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * RunNameEditor — shows the run's name with a timestamp, and lets the owner rename it
 * inline (pencil → text field → save). Persists via PATCH /api/runs/[id]. Falls back to
 * the brand name when the run has no name yet.
 */
export function RunNameEditor({
  runId,
  initialName,
  fallback,
  createdAt,
}: {
  runId: string;
  initialName: string | null;
  fallback: string;
  createdAt: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName ?? fallback);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const trimmed = draft.trim();
    if (!trimmed) { setError('Name cannot be empty.'); return; }
    setSaving(true); setError(null);
    const res = await fetch(`/api/runs/${runId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    }).then((r) => r.json()).catch(() => null);
    setSaving(false);
    if (!res?.ok) { setError(res?.error?.message ?? 'Could not rename.'); return; }
    setName(trimmed);
    setEditing(false);
    router.refresh(); // update the card list / any other view
  }

  const stamp = createdAt
    ? new Date(createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null;

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setEditing(false); setDraft(name); } }}
          autoFocus
          maxLength={120}
          className="field w-72 text-lg font-bold"
          aria-label="Run name"
        />
        <button onClick={save} disabled={saving} className="btn-accent text-sm">{saving ? 'Saving…' : 'Save'}</button>
        <button onClick={() => { setEditing(false); setDraft(name); setError(null); }} className="btn-ghost text-sm">Cancel</button>
        {error && <span className="text-xs text-nogo">{error}</span>}
      </div>
    );
  }

  return (
    <div>
      <div className="group flex items-center gap-2">
        <h1 className="text-2xl font-bold text-ink-text">{name}</h1>
        <button
          onClick={() => { setDraft(name); setEditing(true); }}
          className="rounded p-1 text-ink-muted opacity-0 transition hover:bg-ink-hover hover:text-accent group-hover:opacity-100"
          title="Rename this analysis"
          aria-label="Rename this analysis"
        >
          ✎
        </button>
      </div>
      {stamp && <p className="text-xs text-ink-muted">Created {stamp}</p>}
    </div>
  );
}
