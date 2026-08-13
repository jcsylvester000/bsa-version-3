'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { computeCompleteness, MUST_HAVE, type SectionKey } from '@/lib/modules/completeness';
import {
  VERTICAL_GROUPS, LAND_VERTICALS, OUTLET_FORMATS, TARGET_CUSTOMER, INCOME_BAND,
  EXPANSION_GOAL, FOOTPRINT, SITE_PREFERENCE, CONSENT, type Option,
} from '@/lib/modules/intakeOptions';

interface OutletRow {
  outletName: string;
  format: string;
  address: string;
  lat: string;
  lon: string;
  monthlySalesPhp: string;
  geocoding?: boolean;
  geocoded?: boolean;
}
interface CandidateRow {
  label: string;
  address: string;
  city: string;
  lat: string;
  lon: string;
  siteType: string;
  geocoding?: boolean;
  geocoded?: boolean;
}
interface Prefill {
  vertical: string;
  sections: Record<string, string>;
  outlets: Array<Partial<OutletRow>>;
  candidates: Array<Partial<CandidateRow>>;
}

const SECTION_LABELS: Record<SectionKey, string> = {
  a: 'A · Brand & concept', b: 'B · Target customer', c: 'C · Format & footprint',
  d: 'D · Unit economics', e: 'E · Expansion goals', f: 'F · Site preferences',
  g: 'G · Outlet master', h: 'H · Competitors', i: 'I · Marketing', j: 'J · Operations',
  k: 'K · Governance & consent',
};

/** Reusable labelled dropdown. */
function Select({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-text">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field mt-1">
        <option value="">{placeholder ?? 'Select…'}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function IntakeWizard({
  franchisors, prefill, mockMode = false, mockRunId,
}: {
  franchisors: Array<{ id: string; brandName: string }>;
  prefill?: Prefill; mockMode?: boolean; mockRunId?: string;
}) {
  const router = useRouter();
  const [franchisorId, setFranchisorId] = useState(franchisors[0]?.id ?? '');
  const [vertical, setVertical] = useState<string>(prefill?.vertical ?? 'fnb_cafe');
  const [sections, setSections] = useState<Record<string, string>>(prefill?.sections ?? { k: '' });
  const [outlets, setOutlets] = useState<OutletRow[]>(
    (prefill?.outlets as OutletRow[]) ?? [],
  );
  const [candidates, setCandidates] = useState<CandidateRow[]>(
    (prefill?.candidates as CandidateRow[]) ?? [{ label: '', address: '', city: '', lat: '', lon: '', siteType: 'inline' }],
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLand = LAND_VERTICALS.includes(vertical);

  const completeness = useMemo(() => {
    const filled: Record<string, unknown> = {};
    for (const k of Object.keys(sections)) if (sections[k]?.trim()) filled[k] = sections[k];
    if (outlets.length > 0) filled.g = `${outlets.length} outlets`;
    return computeCompleteness(filled);
  }, [sections, outlets]);

  const setSection = (k: string, v: string) => setSections((s) => ({ ...s, [k]: v }));

  // --- geocoding helpers -----------------------------------------------------
  async function geocode(address: string): Promise<{ lat: number; lon: number; formattedAddress: string } | null> {
    const res = await fetch('/api/geocode', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }),
    });
    const json = await res.json();
    return json.ok ? json.data : null;
  }

  async function geocodeOutlet(i: number) {
    const o = outlets[i];
    if (!o.address.trim()) return;
    setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, geocoding: true } : x)));
    const r = await geocode(o.address);
    setOutlets((cs) => cs.map((x, j) => (j === i ? {
      ...x, geocoding: false, geocoded: !!r,
      lat: r ? String(r.lat) : x.lat, lon: r ? String(r.lon) : x.lon,
    } : x)));
  }

  async function geocodeCandidate(i: number) {
    const c = candidates[i];
    if (!c.address.trim()) return;
    setCandidates((cs) => cs.map((x, j) => (j === i ? { ...x, geocoding: true } : x)));
    const r = await geocode(c.address);
    setCandidates((cs) => cs.map((x, j) => (j === i ? {
      ...x, geocoding: false, geocoded: !!r,
      lat: r ? String(r.lat) : x.lat, lon: r ? String(r.lon) : x.lon,
      city: x.city || (r?.formattedAddress.split(',')[1]?.trim() ?? ''),
    } : x)));
  }

  function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      const lines = text.trim().split(/\r?\n/);
      const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const idx = (n: string) => header.indexOf(n);
      const rows: OutletRow[] = lines.slice(1).map((line) => {
        const c = line.split(',');
        return {
          outletName: c[idx('outlet_name')] ?? c[0] ?? '', format: c[idx('format')] ?? 'inline',
          address: '', lat: c[idx('lat')] ?? '', lon: c[idx('lon')] ?? '',
          monthlySalesPhp: c[idx('monthly_sales_php')] ?? '', geocoded: true,
        };
      }).filter((r) => r.outletName && r.lat && r.lon);
      setOutlets((prev) => [...prev, ...rows]);
    };
    reader.readAsText(file);
  }

  function loadDemo() {
    if (!prefill) return;
    setVertical(prefill.vertical);
    setSections(prefill.sections);
    setOutlets(prefill.outlets as OutletRow[]);
    setCandidates(prefill.candidates as CandidateRow[]);
    setError(null);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    if (mockMode && mockRunId) { router.push(`/territory-guard?runId=${mockRunId}`); return; }
    const payload = {
      franchisorId, vertical, sections,
      outlets: outlets.filter((o) => o.outletName && o.lat && o.lon).map((o) => ({
        outletName: o.outletName, format: o.format || undefined,
        lat: Number(o.lat), lon: Number(o.lon),
        monthlySalesPhp: o.monthlySalesPhp ? Number(o.monthlySalesPhp) : undefined,
      })),
      candidateSites: candidates.filter((c) => c.label && c.lat && c.lon).map((c) => ({
        label: c.label, address: c.address || undefined, city: c.city || undefined,
        lat: Number(c.lat), lon: Number(c.lon), siteType: c.siteType || undefined,
      })),
    };
    const res = await fetch('/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json();
    setSubmitting(false);
    if (!json.ok) { setError(json.error?.message ?? 'Submit failed.'); return; }
    router.push(`/runs?runId=${json.data.runId}`);
  }

  const gateMet = completeness.pct >= 80 && candidates.some((c) => c.label && c.lat && c.lon);

  return (
    <div className="space-y-6">
      {prefill && (
        <div className="flex items-center justify-between card px-4 py-3">
          <p className="text-sm text-accent">Want to see the whole flow fast? Load a complete demo intake.</p>
          <button onClick={loadDemo} className="btn-accent">Load demo data</button>
        </div>
      )}

      {/* completeness meter */}
      <div className="card p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink-text">Completeness (must-have sections)</span>
          <span className={completeness.pct >= 80 ? 'text-go' : 'text-caution'}>{completeness.pct}% / 80% gate</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-ink-panel-2">
          <div className={`h-full ${completeness.pct >= 80 ? 'bg-go' : 'bg-caution'}`} style={{ width: `${completeness.pct}%` }} />
        </div>
        {completeness.missing.length > 0 && (
          <p className="mt-2 text-xs text-ink-muted">Still needed: {completeness.missing.map((m) => SECTION_LABELS[m]).join(', ')}</p>
        )}
      </div>

      {/* brand + vertical */}
      <div className="grid gap-4 md:grid-cols-2">
        <Select label="Franchisor" value={franchisorId} onChange={setFranchisorId}
          options={franchisors.map((f) => ({ value: f.id, label: f.brandName }))} placeholder="Select franchisor…" />
        <label className="block">
          <span className="text-sm font-medium text-ink-text">Business vertical</span>
          <select value={vertical} onChange={(e) => setVertical(e.target.value)} className="field mt-1">
            {VERTICAL_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      {isLand && (
        <div className="rounded-lg border border-muesli/40 bg-muesli/10 px-4 py-2 text-sm text-accent">
          Land-acquisition mode — this vertical is screened on vehicle traffic, road frontage and lot geometry (not mall
          footfall). The Land &amp; Traffic module runs for these candidate sites.
        </div>
      )}

      {/* guided sections (dropdowns where the answer is known; free-text where nuance helps) */}
      <div className="card p-5">
        <p className="mb-3 text-sm font-medium text-ink-text">Brand & requirements</p>
        <div className="grid gap-4 md:grid-cols-2">
          {/* A — free text (concept is genuinely open) */}
          <label className="block md:col-span-2">
            <span className="text-sm font-medium text-ink-text">{SECTION_LABELS.a}</span>
            <input value={sections.a ?? ''} onChange={(e) => setSection('a', e.target.value)}
              placeholder="e.g. Affordable premium milk tea for young urban professionals"
              className="field mt-1" />
          </label>
          <Select label={SECTION_LABELS.b} value={sections.b ?? ''} onChange={(v) => setSection('b', v)} options={TARGET_CUSTOMER} />
          <Select label="Catchment income band" value={sections.b2 ?? ''} onChange={(v) => setSection('b2', v)} options={INCOME_BAND} placeholder="Optional…" />
          <Select label={SECTION_LABELS.c} value={sections.c ?? ''} onChange={(v) => setSection('c', v)} options={FOOTPRINT} />
          {/* D — free text (economics are numeric/nuanced) */}
          <label className="block">
            <span className="text-sm font-medium text-ink-text">{SECTION_LABELS.d}</span>
            <input value={sections.d ?? ''} onChange={(e) => setSection('d', e.target.value)}
              placeholder="e.g. Avg ticket ₱145; target ₱600k–₱900k / month"
              className="field mt-1" />
          </label>
          <Select label={SECTION_LABELS.e} value={sections.e ?? ''} onChange={(v) => setSection('e', v)} options={EXPANSION_GOAL} />
          <Select label={SECTION_LABELS.f} value={sections.f ?? ''} onChange={(v) => setSection('f', v)} options={SITE_PREFERENCE} />
          <Select label={SECTION_LABELS.k} value={sections.k ?? ''} onChange={(v) => setSection('k', v)} options={CONSENT} placeholder="Consent…" />
        </div>
      </div>

      {/* outlet master — easy add-row form + CSV */}
      <div className="card p-5">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-ink-text">G · Existing outlets (your current branches)</p>
            <p className="text-xs text-ink-muted">Add each branch below, or upload a CSV. These power Territory Guard’s cannibalization check.</p>
          </div>
          <label className="cursor-pointer rounded-lg border border-ink-border px-3 py-1.5 text-xs hover:bg-ink-panel-2">
            Upload CSV
            <input type="file" accept=".csv" onChange={onCsv} className="hidden" />
          </label>
        </div>

        {outlets.length > 0 && (
          <div className="mb-3 space-y-2">
            {outlets.map((o, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-lg bg-ink-panel-2 p-2">
                <input placeholder="Branch name" value={o.outletName}
                  onChange={(e) => setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, outletName: e.target.value } : x)))}
                  className="col-span-3 field px-2 py-1.5 text-sm" />
                <select value={o.format}
                  onChange={(e) => setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, format: e.target.value } : x)))}
                  className="col-span-2 field px-2 py-1.5 text-sm">
                  {OUTLET_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <input placeholder="Address (auto-locate)" value={o.address}
                  onChange={(e) => setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, address: e.target.value, geocoded: false } : x)))}
                  onBlur={() => geocodeOutlet(i)}
                  className="col-span-3 field px-2 py-1.5 text-sm" />
                <input placeholder="Monthly sales ₱" value={o.monthlySalesPhp}
                  onChange={(e) => setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, monthlySalesPhp: e.target.value } : x)))}
                  className="col-span-2 field px-2 py-1.5 text-sm" />
                <div className="col-span-2 text-xs">
                  {o.geocoding ? <span className="text-ink-muted">locating…</span>
                    : o.lat && o.lon ? <span className="text-go">✓ {Number(o.lat).toFixed(3)}, {Number(o.lon).toFixed(3)}</span>
                    : <span className="text-ink-muted">no location</span>}
                </div>
              </div>
            ))}
          </div>
        )}
        <button
          onClick={() => setOutlets((cs) => [...cs, { outletName: '', format: 'inline', address: '', lat: '', lon: '', monthlySalesPhp: '' }])}
          className="text-sm text-accent hover:underline">+ Add a branch</button>
        <p className="mt-1 text-xs text-ink-muted">CSV headers: outlet_name, format, lat, lon, monthly_sales_php</p>
      </div>

      {/* candidate sites — address → auto-locate */}
      <div className="card p-5">
        <p className="mb-1 text-sm font-medium text-ink-text">Candidate sites to evaluate</p>
        <p className="mb-3 text-xs text-ink-muted">Type an address and we’ll locate it on the map automatically.</p>
        <div className="space-y-2">
          {candidates.map((c, i) => (
            <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-lg bg-ink-panel-2 p-2">
              <input placeholder="Label (e.g. Proposed — BGC High Street)" value={c.label}
                onChange={(e) => setCandidates((cs) => cs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                className="col-span-3 field px-2 py-1.5 text-sm" />
              <input placeholder="Address" value={c.address}
                onChange={(e) => setCandidates((cs) => cs.map((x, j) => (j === i ? { ...x, address: e.target.value, geocoded: false } : x)))}
                onBlur={() => geocodeCandidate(i)}
                className="col-span-4 field px-2 py-1.5 text-sm" />
              <select value={c.siteType}
                onChange={(e) => setCandidates((cs) => cs.map((x, j) => (j === i ? { ...x, siteType: e.target.value } : x)))}
                className="col-span-2 field px-2 py-1.5 text-sm">
                {OUTLET_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
              <div className="col-span-3 text-xs">
                {c.geocoding ? <span className="text-ink-muted">locating…</span>
                  : c.lat && c.lon ? <span className="text-go">✓ located</span>
                  : <span className="text-ink-muted">enter an address</span>}
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={() => setCandidates((cs) => [...cs, { label: '', address: '', city: '', lat: '', lon: '', siteType: 'inline' }])}
          className="mt-2 text-sm text-accent hover:underline">+ Add another site</button>
      </div>

      {error && <p className="text-sm text-nogo">{error}</p>}

      <div className="flex items-center gap-3">
        <button onClick={submit} disabled={!gateMet || submitting || !franchisorId}
          className="rounded-lg bg-nile-blue px-6 py-2.5 font-medium text-white hover:bg-midnight disabled:opacity-50">
          {submitting ? 'Submitting…' : 'Submit & run'}
        </button>
        {!gateMet && <span className="text-xs text-ink-muted">Complete the must-have fields and add at least one located candidate site to submit.</span>}
      </div>
    </div>
  );
}
