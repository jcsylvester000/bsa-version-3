'use client';

/** Triggers the browser print dialog — the scorecard is designed to print as a one-pager. */
export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg border border-accent px-4 py-2 text-sm font-medium text-accent transition hover:bg-accent hover:text-ink-bg"
    >
      Print / Save PDF
    </button>
  );
}
