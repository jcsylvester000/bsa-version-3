'use client';

import { useEffect, useState } from 'react';

/**
 * Client-details modal for the downloadable report. Collects who the report is for and
 * who prepared it — so an agent/broker can hand a client-ready, personalised document to
 * their client. Details are remembered per browser (sessionStorage) so re-downloads reuse
 * them. On submit it POSTs them to the branded full-report HTML (opened in a new tab; the user prints to PDF).
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

  // Esc closes the dialog (keyboard users).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  function set<K extends keyof ReportClient>(k: K, v: string) {
    setC((prev) => ({ ...prev, [k]: v }));
  }

  function openReport() {
    try {
      sessionStorage.setItem(storageKey(runId), JSON.stringify(c));
    } catch {
      /* ignore */
    }
    // POST the cover details in a form body (opened in a new tab) — keeps client names and
    // phone numbers out of URLs, history and logs.
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/reports/full';
    form.target = '_blank';
    const fields: Record<string, string> = {
      runId,
      preparedFor: c.preparedFor.trim(),
      ownerName: c.ownerName.trim(),
      company: c.company.trim(),
      contactNumber: c.contactNumber.trim(),
      email: c.email.trim(),
    };
    for (const [name, value] of Object.entries(fields)) {
      if (!value) continue;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    form.remove();
    setOpen(false);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-primary btn-lg">
        Download full report
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Report details">
          <div className="absolute inset-0 bg-midnight/70" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-lg rounded-modal border border-ink-border-strong bg-ink-panel p-6 text-ink-text shadow-e3">
            <div className="mb-1 flex items-center gap-2">
              <div className="h-1.5 w-8 rounded-full bg-accent" />
            </div>
            <h2 className="font-body text-title text-ink-text">Prepare the report</h2>
            <p className="mb-4 mt-1 text-body text-ink-muted">
              Add the details that appear on the cover. All optional — leave any blank and it’s simply omitted.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="field-label">Prepared for (client)</span>
                <input value={c.preparedFor} onChange={(e) => set('preparedFor', e.target.value)} placeholder="e.g. Juan Dela Cruz / ABC Franchising Corp." className="field mt-1.5" />
              </label>
              <label className="block">
                <span className="field-label">Report owner</span>
                <input value={c.ownerName} onChange={(e) => set('ownerName', e.target.value)} placeholder="Your name" className="field mt-1.5" />
              </label>
              <label className="block">
                <span className="field-label">Company</span>
                <input value={c.company} onChange={(e) => set('company', e.target.value)} placeholder="Your company" className="field mt-1.5" />
              </label>
              <label className="block">
                <span className="field-label">Contact number</span>
                <input value={c.contactNumber} onChange={(e) => set('contactNumber', e.target.value)} placeholder="e.g. +63 917 000 0000" className="field mt-1.5" />
              </label>
              <label className="block">
                <span className="field-label">Email</span>
                <input value={c.email} onChange={(e) => set('email', e.target.value)} placeholder="you@company.com" className="field mt-1.5" />
              </label>
            </div>

            <div className="mt-6 flex items-center justify-between">
              <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
              <button type="button" onClick={openReport} className="btn-primary">Open report → print to PDF</button>
            </div>
            <p className="mt-3 text-label font-normal text-ink-muted">
              The report opens in a new tab. Use your browser’s Print → “Save as PDF” to download it.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
