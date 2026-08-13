'use client';

import { useEffect, useState } from 'react';

/**
 * Client-details modal for the downloadable report. Collects who the report is for and
 * who prepared it — so an agent/broker can hand a client-ready, personalised document to
 * their client. Details are remembered per browser (sessionStorage) so re-downloads reuse
 * them. On submit it opens the branded full-report HTML (which the user prints to PDF).
 */
export interface ReportClient {
  preparedFor: string;
  ownerName: string;
  company: string;
  contactNumber: string;
  email: string;
}

const EMPTY: ReportClient = { preparedFor: '', ownerName: '', company: '', contactNumber: '', email: '' };

function storageKey(runId: string) {
  return `bsa:report-client:${runId}`;
}

export function ReportDownloadModal({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [c, setC] = useState<ReportClient>(EMPTY);

  // Prefill from a previous entry for this run.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey(runId));
      if (raw) setC({ ...EMPTY, ...JSON.parse(raw) });
    } catch {
      /* ignore */
    }
  }, [runId]);

  function set<K extends keyof ReportClient>(k: K, v: string) {
    setC((prev) => ({ ...prev, [k]: v }));
  }

  function openReport() {
    try {
      sessionStorage.setItem(storageKey(runId), JSON.stringify(c));
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams({ runId });
    if (c.preparedFor.trim()) params.set('preparedFor', c.preparedFor.trim());
    if (c.ownerName.trim()) params.set('ownerName', c.ownerName.trim());
    if (c.company.trim()) params.set('company', c.company.trim());
    if (c.contactNumber.trim()) params.set('contactNumber', c.contactNumber.trim());
    if (c.email.trim()) params.set('email', c.email.trim());
    window.open(`/api/reports/full?${params.toString()}`, '_blank', 'noopener');
    setOpen(false);
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-accent">
        Download full report
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Report details">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg rounded-2xl border border-ink-border bg-ink-panel p-6 shadow-2xl">
            <div className="mb-1 flex items-center gap-2">
              <div className="h-1.5 w-8 rounded-full bg-accent" />
            </div>
            <h2 className="text-lg font-bold text-ink-text">Prepare the report</h2>
            <p className="mb-4 mt-1 text-sm text-ink-muted">
              Add the details that appear on the cover. All optional — leave any blank and it’s simply omitted.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Prepared for (client)</span>
                <input value={c.preparedFor} onChange={(e) => set('preparedFor', e.target.value)} placeholder="e.g. Juan Dela Cruz / ABC Franchising Corp." className="field mt-1" />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Report owner</span>
                <input value={c.ownerName} onChange={(e) => set('ownerName', e.target.value)} placeholder="Your name" className="field mt-1" />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Company</span>
                <input value={c.company} onChange={(e) => set('company', e.target.value)} placeholder="Your company" className="field mt-1" />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Contact number</span>
                <input value={c.contactNumber} onChange={(e) => set('contactNumber', e.target.value)} placeholder="e.g. +63 917 000 0000" className="field mt-1" />
              </label>
              <label className="block">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-muted">Email</span>
                <input value={c.email} onChange={(e) => set('email', e.target.value)} placeholder="you@company.com" className="field mt-1" />
              </label>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button onClick={() => setOpen(false)} className="btn-ghost text-sm">Cancel</button>
              <button onClick={openReport} className="btn-accent">Open report → print to PDF</button>
            </div>
            <p className="mt-3 text-[11px] text-ink-muted">
              The report opens in a new tab. Use your browser’s Print → “Save as PDF” to download it.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
