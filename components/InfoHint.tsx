'use client';

import { useState } from 'react';

/**
 * InfoHint — a small ⓘ icon that reveals a brief "how to read this" explainer on
 * hover OR click (click keeps it open on touch devices). Straight, short copy only.
 * Drop it next to any result heading: <InfoHint text="Overlap % is measured…" />
 */
export function InfoHint({ text, label }: { text: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label ?? 'What is this?'}
        className="grid h-4 w-4 place-items-center rounded-full border border-ink-border text-[10px] font-bold text-ink-muted hover:border-accent hover:text-accent"
      >
        i
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 rounded-lg border border-ink-border bg-ink-panel-2 p-3 text-left text-xs font-normal leading-relaxed text-ink-text shadow-xl"
        >
          {text}
        </span>
      )}
    </span>
  );
}
