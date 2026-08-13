'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { computeCompleteness } from '@/lib/modules/completeness';
import { sectorForVertical, verticalForBrand } from '@/lib/brands/brandVertical';
import { DEMO_SCENARIOS } from '@/lib/mock/demoData';
import { LocationPicker } from '@/components/LocationPicker';
import { AnalysisOverlay } from '@/components/AnalysisSequence';
import {
  VERTICAL_GROUPS, LAND_VERTICALS, OUTLET_FORMATS, TARGET_CUSTOMER, INCOME_BAND,
  EXPANSION_GOAL, FOOTPRINT, SITE_PREFERENCE, CONSENT, type Option,
  MALL_TIER, LAND_PARCEL, SERVICE_UNITS, MALL_VERTICALS, UNIT_VERTICALS, UNIT_NAME_SIGNALS,
} from '@/lib/modules/intakeOptions';

// Module chips shown per vertical (core always on; extras per format).
const MODULE_CHIPS: Record<string, { key: string; label: string; kind: 'core' | 'new' | 'vertical' | 'health' | 'land' }[]> = {
  base: [
    { key: 'site_fit', label: 'Site Fit Scoring', kind: 'core' },
    { key: 'financial', label: 'Financial Model', kind: 'core' },
    { key: 'risk', label: 'Risk Matrix', kind: 'core' },
    { key: 'territory', label: 'Territory Guard', kind: 'new' },
    { key: 'lease', label: 'Lease Benchmark', kind: 'new' },
    { key: 'daypart', label: 'Daypart Demand', kind: 'new' },
    { key: 'whitespace', label: 'White-Space', kind: 'new' },
    { key: 'mall', label: 'Mall Intelligence', kind: 'vertical' },
    { key: 'land', label: 'Land & Traffic', kind: 'land' },
    { key: 'healthcare', label: 'Healthcare POI', kind: 'health' },
  ],
};

// Every vertical actually runs today — F&B is fully live, the rest are usable in beta.
// (Previously these wore future "Q3 2026" dates that read as "not available yet" and
// undersold working analysis; "BETA" signals early-but-usable instead.)
const VERTICAL_CARDS = [
  { group: 'Food & Beverage', quarter: 'LIVE', desc: 'QSR, dining, cafe, milk tea, bakery', match: (v: string) => v.startsWith('fnb_') },
  { group: 'Healthcare', quarter: 'BETA', desc: 'Pharmacy, diagnostics, dialysis', match: (v: string) => ['pharmacy', 'diagnostics'].includes(v) },
  { group: 'Retail & Mall', quarter: 'BETA', desc: 'Apparel, specialty, mall-based', match: (v: string) => v.startsWith('retail_') || v === 'convenience' },
  { group: 'Land-Intensive', quarter: 'BETA', desc: 'Fuel, automotive, hotel', match: (v: string) => LAND_VERTICALS.includes(v) },
];

// Friendly labels for the must-have completeness sections, so the gate can tell the user
// exactly WHICH field unlocks the next step instead of just showing a stuck percentage.
const SECTION_LABELS: Record<string, string> = {
  a: 'Brand & concept',
  b: 'Target customer',
  c: 'Format & footprint',
  d: 'Unit economics',
  e: 'Expansion goals',
  f: 'Site preferences',
  g: 'Existing outlets',
  k: 'Governance & consent',
};

interface OutletRow { outletName: string; format: string; address: string; lat: string; lon: string; monthlySalesPhp: string; geocoding?: boolean; }
interface CandidateRow { label: string; address: string; city: string; lat: string; lon: string; siteType: string; geocoding?: boolean; }


function Select({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string }) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-muted">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="field mt-1">
        <option value="">{placeholder ?? 'Select…'}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/**
 * Dropdown with a manual fallback (QA v6): pick a common answer, or choose
 * "Other / enter manually" to type an exact value. Guarantees every
 * category-conditional input is completable by dropdown OR manual entry.
 */
function SelectOrManual({ label, value, onChange, options, placeholder }: { label: string; value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string }) {
  const isPreset = options.some((o) => o.value === value);
  const manual = value !== '' && !isPreset;
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-muted">{label}</span>
      <select
        value={manual ? '__manual__' : value}
        onChange={(e) => onChange(e.target.value === '__manual__' ? ' ' : e.target.value)}
        className="field mt-1"
      >
        <option value="">{placeholder ?? 'Select…'}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        <option value="__manual__">Other / enter manually…</option>
      </select>
      {manual && (
        <input
          value={value.trim() === '' ? '' : value}
          autoFocus
          onChange={(e) => onChange(e.target.value === '' ? ' ' : e.target.value)}
          placeholder="Type the exact value…"
          className="field mt-2 text-sm"
        />
      )}
    </label>
  );
}

const STEPS = ['Business vertical', 'Brand & requirements', 'Existing outlets', 'Candidate sites'];

export function SteppedIntakeWizard({ franchisors, mockMode = false, mockRunId, editIntakeId = null }: {
  franchisors: Array<{ id: string; brandName: string }>; mockMode?: boolean; mockRunId?: string; editIntakeId?: string | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  // Edit-and-rerun: the lineage parent whose inputs we loaded (submit → new version).
  const [parentIntakeId, setParentIntakeId] = useState<string | null>(null);
  const [franchisorId, setFranchisorId] = useState(franchisors[0]?.id ?? '');
  const [vertical, setVertical] = useState('fnb_cafe');
  // Business type: an existing franchisor on file, or an independent operator who
  // benchmarks against a comparable brand so the scoring adapts to their concept.
  const [bizType, setBizType] = useState<'franchisor' | 'independent'>('franchisor');
  const [indieName, setIndieName] = useState('');
  const [comparableBrand, setComparableBrand] = useState('');
  const [brandGroups, setBrandGroups] = useState<Array<{ category: string; brands: Array<{ brand: string; vertical: string; count: number }> }>>([]);
  // Full shared franchise-brand catalog (grouped by sector) for the intake dropdown.
  const [franchisorGroups, setFranchisorGroups] = useState<Array<{ sector: string; brands: Array<{ id: string; brandName: string; subCategory: string | null; vertical: string | null }> }>>([]);
  // Inline "add a new franchise brand" creator.
  const [addingBrand, setAddingBrand] = useState(false);
  const [newBrand, setNewBrand] = useState({ brandName: '', sector: 'FnB', subCategory: '' });
  const [brandError, setBrandError] = useState<string | null>(null);
  // Franchise requirements template for the selected brand (if any).
  const [template, setTemplate] = useState<{ brandName: string; requirements: Record<string, string | null>; prefill: Record<string, string> } | null>(null);
  const [sections, setSections] = useState<Record<string, string>>({});
  const [outlets, setOutlets] = useState<OutletRow[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([{ label: '', address: '', city: '', lat: '', lon: '', siteType: 'inline' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Generate animation on submit+run, then navigate when BOTH the pipeline finished
  // (pendingRunId set) AND the animation completed (animDone) — race-proof either order.
  const [animating, setAnimating] = useState(false);
  const [animDone, setAnimDone] = useState(false);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  // Map-pin modal target: which row (outlet/candidate) is being pinned.
  const [pinTarget, setPinTarget] = useState<{ kind: 'outlet' | 'candidate'; index: number } | null>(null);

  const isLand = LAND_VERTICALS.includes(vertical);
  const setSection = (k: string, v: string) => setSections((s) => ({ ...s, [k]: v }));

  // Load comparable brands (real chains in the DB) for the independent-business picker.
  useEffect(() => {
    fetch('/api/brands').then((r) => r.json()).then((j) => { if (j.ok) setBrandGroups(j.data.groups); }).catch(() => {});
  }, []);

  // Load the shared franchise-brand catalog (grouped by sector) for the intake dropdown.
  function loadFranchisors(selectId?: string) {
    return fetch('/api/franchisors').then((r) => r.json()).then((j) => {
      if (j.ok) { setFranchisorGroups(j.data.groups); if (selectId) setFranchisorId(selectId); }
    }).catch(() => {});
  }
  useEffect(() => { loadFranchisors(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Edit-and-rerun: preload the previous intake's inputs, and remember its lineage so
  // submitting creates a NEW VERSION rather than a brand-new intake.
  useEffect(() => {
    if (!editIntakeId) return;
    fetch(`/api/intake/${editIntakeId}`).then((r) => r.json()).then((j) => {
      if (!j.ok) return;
      const d = j.data;
      setParentIntakeId(d.id);
      if (d.vertical) setVertical(d.vertical);
      if (d.franchisor?.id) { setBizType('franchisor'); setFranchisorId(d.franchisor.id); }
      if (d.sections) setSections({ ...d.sections });
      if (Array.isArray(d.outlets)) setOutlets(d.outlets.map((o: OutletRow) => ({ outletName: o.outletName, format: o.format ?? 'inline', address: '', lat: o.lat, lon: o.lon, monthlySalesPhp: o.monthlySalesPhp ?? '' })));
      if (Array.isArray(d.candidateSites) && d.candidateSites.length) setCandidates(d.candidateSites.map((c: CandidateRow) => ({ label: c.label, address: c.address ?? '', city: c.city ?? '', lat: c.lat, lon: c.lon, siteType: c.siteType ?? 'inline' })));
    }).catch(() => {});
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [editIntakeId]);

  // When a franchise brand is selected, fetch its requirements template (if any).
  useEffect(() => {
    if (bizType !== 'franchisor' || !franchisorId) { setTemplate(null); return; }
    let cancelled = false;
    fetch(`/api/franchisors/${franchisorId}`).then((r) => r.json()).then((j) => {
      if (!cancelled && j.ok && j.data.hasTemplate) setTemplate({ brandName: j.data.brandName, requirements: j.data.requirements, prefill: j.data.prefill });
      else if (!cancelled) setTemplate(null);
    }).catch(() => { if (!cancelled) setTemplate(null); });
    return () => { cancelled = true; };
  }, [franchisorId, bizType]);

  // Apply the franchise template's prefill into the brief (Step 2) — non-destructive
  // choice by the user (they click the button). Fills only fields the template supplies.
  function applyTemplate() {
    if (!template) return;
    setSections((s) => ({ ...s, ...template.prefill }));
  }

  // Create a new franchise brand inline, then select it.
  async function createBrand() {
    setBrandError(null);
    if (newBrand.brandName.trim().length < 2) { setBrandError('Enter a brand name.'); return; }
    const res = await fetch('/api/franchisors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandName: newBrand.brandName.trim(), sector: newBrand.sector, subCategory: newBrand.subCategory.trim() || undefined }),
    }).then((r) => r.json());
    if (!res.ok) { setBrandError(res.error?.message ?? 'Could not add brand.'); return; }
    await loadFranchisors(res.data.id);
    setAddingBrand(false);
    setNewBrand({ brandName: '', sector: 'FnB', subCategory: '' });
  }

  // Navigate to the results dashboard once the run exists AND the animation finished.
  useEffect(() => {
    if (pendingRunId && animDone) router.push(`/runs?runId=${pendingRunId}`);
  }, [pendingRunId, animDone, router]);

  // When an independent picks a comparable brand, snap the vertical to that brand's
  // concept so the right modules + competitor discrimination activate. Uses the shared
  // brand→vertical map as the authoritative source (so e.g. Chatime always → fnb_cafe),
  // and only falls back to the live brandGroups list if the brand isn't mapped. This
  // prevents a stale vertical (e.g. "fuel" left over from a category-card click) from
  // being submitted.
  function pickComparable(brand: string) {
    setComparableBrand(brand);
    const mapped = verticalForBrand(brand);
    if (mapped) { setVertical(mapped); return; }
    for (const g of brandGroups) {
      const hit = g.brands.find((b) => b.brand === brand);
      if (hit) { setVertical(hit.vertical); break; }
    }
  }

  // Load one of the 5 demo scenarios into every step. Fills vertical, all dropdowns,
  // the real existing outlets, and the candidates — ready to submit. Every scenario
  // sits in a data-rich NCR corridor so every module resolves from the DB (no Google).
  function loadDemo(key: string) {
    const s = DEMO_SCENARIOS.find((x) => x.key === key) ?? DEMO_SCENARIOS[0];
    setVertical(s.vertical);
    // Independent demo → set the independent business type + comparable brand.
    if (s.independent) {
      setBizType('independent');
      setIndieName(s.independent.name);
      setComparableBrand(s.independent.comparableBrand);
    } else {
      setBizType('franchisor');
      setIndieName(''); setComparableBrand('');
      // Auto-select the matching catalog brand by name if present.
      const match = franchisorGroups.flatMap((g) => g.brands).find((b) => b.brandName.toLowerCase() === s.brandName.toLowerCase());
      if (match) setFranchisorId(match.id);
    }
    setSections({ ...s.sections });
    setOutlets(s.outlets.map((o) => ({
      outletName: o.outletName, format: o.format, address: o.address,
      lat: o.lat, lon: o.lon, monthlySalesPhp: o.monthlySalesPhp,
    })));
    setCandidates(s.candidates.map((c) => ({
      label: c.label, address: c.address, city: c.city,
      lat: c.lat, lon: c.lon, siteType: c.siteType,
    })));
    setError(null);
    setStep(0);
  }

  const completeness = useMemo(() => {
    const filled: Record<string, unknown> = {};
    for (const k of Object.keys(sections)) if (sections[k]?.trim()) filled[k] = sections[k];
    if (outlets.length > 0) filled.g = `${outlets.length}`;
    return computeCompleteness(filled);
  }, [sections, outlets]);

  // Franchise-brand dropdown filtered to the selected vertical. A brand with a known
  // vertical must match it exactly; brands without a mapped vertical fall back to the
  // vertical's broad sector, so newly-added brands still show under the right category.
  const visibleFranchisorGroups = useMemo(() => {
    const wantSector = sectorForVertical(vertical);
    return franchisorGroups
      .map((g) => ({
        sector: g.sector,
        brands: g.brands.filter((b) => (b.vertical ? b.vertical === vertical : g.sector === wantSector)),
      }))
      .filter((g) => g.brands.length > 0);
  }, [franchisorGroups, vertical]);

  // If the currently-selected brand no longer matches the chosen vertical, clear it so
  // the user can't submit a mismatched brand/vertical pair.
  useEffect(() => {
    if (!franchisorId) return;
    const stillVisible = visibleFranchisorGroups.some((g) => g.brands.some((b) => b.id === franchisorId));
    if (!stillVisible) setFranchisorId('');
  }, [visibleFranchisorGroups, franchisorId]);

  async function geocode(address: string) {
    // Geocoding is off in DB-only mode — returns null and the user pins on the map (📍).
    const r = await fetch('/api/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address }) }).then((x) => x.json()).catch(() => null);
    return r?.ok ? r.data : null;
  }
  async function geocodeOutlet(i: number) {
    const o = outlets[i]; if (!o.address.trim()) return;
    setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, geocoding: true } : x)));
    const r = await geocode(o.address);
    setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, geocoding: false, lat: r ? String(r.lat) : x.lat, lon: r ? String(r.lon) : x.lon } : x)));
  }
  async function geocodeCandidate(i: number) {
    const c = candidates[i]; if (!c.address.trim()) return;
    setCandidates((cs) => cs.map((x, j) => (j === i ? { ...x, geocoding: true } : x)));
    const r = await geocode(c.address);
    setCandidates((cs) => cs.map((x, j) => (j === i ? { ...x, geocoding: false, lat: r ? String(r.lat) : x.lat, lon: r ? String(r.lon) : x.lon, city: x.city || (r?.formattedAddress.split(',')[1]?.trim() ?? '') } : x)));
  }
  function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result ?? '').trim().split(/\r?\n/);
      const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
      const idx = (n: string) => header.indexOf(n);
      const rows: OutletRow[] = lines.slice(1).map((line) => {
        const c = line.split(',');
        return { outletName: c[idx('outlet_name')] ?? c[0] ?? '', format: c[idx('format')] ?? 'inline', address: '', lat: c[idx('lat')] ?? '', lon: c[idx('lon')] ?? '', monthlySalesPhp: c[idx('monthly_sales_php')] ?? '' };
      }).filter((r) => r.outletName && r.lat && r.lon);
      setOutlets((prev) => [...prev, ...rows]);
    };
    reader.readAsText(file);
  }
  async function submit() {
    setSubmitting(true); setError(null);
    // Only the built-in demo experience short-circuits to the sample run. A real
    // submission always goes to the API below and gets a real UUID run id back.
    if (mockMode && mockRunId) { router.push(`/runs?runId=${mockRunId}`); setSubmitting(false); return; }
    const payload = {
      // Existing franchise → franchisorId. Independent → we send the business name +
      // comparable brand, and the API creates a lightweight franchisor on the fly.
      ...(bizType === 'franchisor'
        ? { franchisorId }
        : { independent: { name: indieName.trim(), comparableBrand: comparableBrand.trim() } }),
      vertical, sections,
      outlets: outlets.filter((o) => o.outletName && o.lat && o.lon).map((o) => ({ outletName: o.outletName, format: o.format || undefined, lat: Number(o.lat), lon: Number(o.lon), monthlySalesPhp: o.monthlySalesPhp ? Number(o.monthlySalesPhp) : undefined })),
      candidateSites: candidates.filter((c) => c.label && c.lat && c.lon).map((c) => ({ label: c.label, address: c.address || undefined, city: c.city || undefined, lat: Number(c.lat), lon: Number(c.lon), siteType: c.siteType || undefined })),
      ...(parentIntakeId ? { parentIntakeId } : {}),
    };
    const res = await fetch('/api/intake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then((r) => r.json());
    if (!res.ok) { setSubmitting(false); setError(res.error?.message ?? 'Submit failed.'); return; }
    const runId = res.data.runId;
    // Show the generate animation while the deterministic pipeline runs (a deliberate
    // "generate final result" moment), then navigate to the populated dashboard.
    setAnimating(true);
    try {
      await fetch(`/api/runs/${runId}/run`, { method: 'POST' });
    } catch {
      /* dashboard shows the manual Run pipeline control as a fallback */
    }
    setSubmitting(false);
    setPendingRunId(runId); // navigation happens when the animation completes
  }

  const activeVerticalGroup = VERTICAL_CARDS.find((c) => c.match(vertical)) ?? VERTICAL_CARDS[0];
  // Category-conditional field visibility (QA v6). A brand/concept name signal (e.g.
  // "water refill", "laundromat") also triggers the per-unit field for verticals filed
  // under a generic picker (water stations sit under convenience/other).
  const nameSignal = (sections.a ?? '').toLowerCase();
  const showLandField = LAND_VERTICALS.includes(vertical);
  const showMallField = MALL_VERTICALS.includes(vertical);
  const showUnitField = UNIT_VERTICALS.includes(vertical) || UNIT_NAME_SIGNALS.some((s) => nameSignal.includes(s));
  const chipActive = (kind: string) => {
    if (kind === 'core' || kind === 'new') return true;
    if (kind === 'land') return isLand;
    if (kind === 'health') return ['pharmacy', 'diagnostics'].includes(vertical);
    if (kind === 'vertical') return vertical.startsWith('retail_') || vertical === 'services_spa';
    return false;
  };
  // A valid business identity: an existing franchisor, OR an independent that has a
  // name + a comparable brand chosen.
  const bizReady = bizType === 'franchisor' ? !!franchisorId : (indieName.trim().length >= 2 && !!comparableBrand);
  const canNext = step === 0 ? (!!vertical && bizReady) : step === 1 ? completeness.pct >= 80 : true;
  const gateMet = completeness.pct >= 80 && candidates.some((c) => c.label && c.lat && c.lon);

  return (
    <div className="space-y-6">
      <AnalysisOverlay
        feature="dashboard"
        active={animating}
        onDone={() => { setAnimating(false); setAnimDone(true); }}
      />
      {/* progress */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${i <= step ? 'bg-accent text-ink-bg' : 'bg-ink-panel-2 text-ink-muted'}`}>{i + 1}</span>
              <span className={i === step ? 'text-ink-text' : 'text-ink-muted'}>{s}</span>
              {i < STEPS.length - 1 && <span className="text-ink-muted">·</span>}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-muted">⚡ Demo</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) loadDemo(e.target.value); }}
            title="Fill every field with a data-backed demo scenario"
            className="field w-auto text-xs"
          >
            <option value="">Load a scenario…</option>
            {DEMO_SCENARIOS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs uppercase tracking-wider text-ink-muted">Intake & brief · Step {step + 1} of 4</p>

      {/* STEP 1 — vertical cards + module toggles */}
      {step === 0 && (
        <div className="space-y-5">
          <div>
            <h2 className="text-xl font-bold text-ink-text">Choose the business vertical</h2>
            <p className="text-sm text-ink-muted">Each vertical activates only the modules and datasets that matter for it — so a fuel station is screened on land and traffic, not mall footfall.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {VERTICAL_CARDS.map((c) => {
              const active = activeVerticalGroup.group === c.group;
              return (
                <button key={c.group} onClick={() => {
                  const first = VERTICAL_GROUPS.find((g) => g.options.some((o) => c.match(o.value)))?.options.find((o) => c.match(o.value));
                  if (first) setVertical(first.value);
                }} className={`card p-4 text-left transition ${active ? 'border-accent ring-1 ring-accent' : 'hover:bg-ink-hover'}`}>
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-ink-text">{c.group}</p>
                    <span className={`pill text-[10px] ${c.quarter === 'LIVE' ? 'pill-go' : 'bg-accent/15 text-accent'}`}>{c.quarter}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{c.desc}</p>
                </button>
              );
            })}
          </div>

          {/* business type — existing franchisor, or an independent operator */}
          <div className="card p-4">
            <div className="mb-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => setBizType('franchisor')} disabled={!franchisors.length}
                className={`rounded-lg px-3 py-1.5 text-sm ${bizType === 'franchisor' ? 'bg-accent text-ink-bg' : 'bg-ink-panel-2 text-ink-muted'} disabled:opacity-40`}>
                Existing franchise on file
              </button>
              <button type="button" onClick={() => setBizType('independent')}
                className={`rounded-lg px-3 py-1.5 text-sm ${bizType === 'independent' ? 'bg-accent text-ink-bg' : 'bg-ink-panel-2 text-ink-muted'}`}>
                Independent business
              </button>
            </div>

            {bizType === 'franchisor' ? (
              <div className="space-y-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <Select label="Exact vertical" value={vertical} onChange={setVertical} options={VERTICAL_GROUPS.flatMap((g) => g.options)} />
                  <label className="block">
                    <span className="text-sm font-medium text-ink-muted">Franchise brand</span>
                    <select
                      value={franchisorId}
                      onChange={(e) => { if (e.target.value === '__add__') { setAddingBrand(true); } else { setFranchisorId(e.target.value); } }}
                      className="field mt-1"
                    >
                      <option value="">Select a brand…</option>
                      {visibleFranchisorGroups.map((g) => (
                        <optgroup key={g.sector} label={g.sector}>
                          {g.brands.map((b) => <option key={b.id} value={b.id}>{b.brandName}</option>)}
                        </optgroup>
                      ))}
                      <option value="__add__">＋ Add a new franchise brand…</option>
                    </select>
                    <span className="mt-1 block text-xs text-ink-muted">
                      {visibleFranchisorGroups.length === 0
                        ? 'No brands on file for this vertical yet — add one with ＋, or switch vertical.'
                        : 'Brands matching your selected vertical. Not listed? Add it.'}
                    </span>
                  </label>
                </div>

                {/* Franchise requirements template — one-click prefill for brands we have it for. */}
                {template && (
                  <div className="card p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-ink-text">📋 {template.brandName} franchise template</p>
                      <button type="button" onClick={applyTemplate} className="btn-accent text-xs">Use this template</button>
                    </div>
                    <p className="mb-3 text-xs text-ink-muted">One click fills your brief (Step 2) from this brand’s known franchise requirements. Every field stays editable.</p>
                    <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-3">
                      {([
                        ['Franchise fee', template.requirements.franchiseFee],
                        ['Total investment', template.requirements.totalInvestment],
                        ['Min. space', template.requirements.minSpace],
                        ['Est. ROI / payback', template.requirements.roiPayback],
                        ['Staffing', template.requirements.staffing],
                        ['Contract term', template.requirements.contractTerm],
                      ] as Array<[string, string | null]>).filter(([, v]) => v).map(([label, v]) => (
                        <div key={label} className="card-inset p-2">
                          <p className="text-[11px] uppercase tracking-wide text-ink-muted">{label}</p>
                          <p className="text-ink-text">{v}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] text-ink-muted">
                      {template.requirements.truthLayer && <span className="mr-1 rounded bg-ink-panel-2 px-1.5 py-0.5">{template.requirements.truthLayer}{template.requirements.confidence ? ` · ${template.requirements.confidence}` : ''}</span>}
                      Figures are indicative and subject to franchisor change — validate with the brand before commitment.{template.requirements.source ? ` Source: ${template.requirements.source}.` : ''}
                    </p>
                  </div>
                )}

                {addingBrand && (
                  <div className="card p-4">
                    <p className="mb-3 text-sm font-medium text-ink-text">Add a new franchise brand</p>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="block">
                        <span className="text-xs text-ink-muted">Brand name</span>
                        <input value={newBrand.brandName} onChange={(e) => setNewBrand((b) => ({ ...b, brandName: e.target.value }))} placeholder="e.g. Kanto Freshcup" className="field mt-1" />
                      </label>
                      <label className="block">
                        <span className="text-xs text-ink-muted">Sector</span>
                        <select value={newBrand.sector} onChange={(e) => setNewBrand((b) => ({ ...b, sector: e.target.value }))} className="field mt-1">
                          <option value="FnB">Food & Beverage</option>
                          <option value="Retail">Retail</option>
                          <option value="Services">Services</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-xs text-ink-muted">Category (optional)</span>
                        <input value={newBrand.subCategory} onChange={(e) => setNewBrand((b) => ({ ...b, subCategory: e.target.value }))} placeholder="e.g. Milk tea / beverages" className="field mt-1" />
                      </label>
                    </div>
                    {brandError && <p className="mt-2 text-xs text-nogo">{brandError}</p>}
                    <div className="mt-3 flex gap-2">
                      <button type="button" onClick={createBrand} className="btn-accent text-sm">Add & select</button>
                      <button type="button" onClick={() => { setAddingBrand(false); setBrandError(null); }} className="btn-ghost text-sm">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="block">
                    <span className="text-sm font-medium text-ink-muted">Your business name</span>
                    <input value={indieName} onChange={(e) => setIndieName(e.target.value)} placeholder="e.g. BrewLab Tea" className="field mt-1" />
                  </label>
                  <label className="block">
                    <span className="text-sm font-medium text-ink-muted">Most similar established brand</span>
                    <select value={comparableBrand} onChange={(e) => pickComparable(e.target.value)} className="field mt-1">
                      <option value="">Pick a comparable brand…</option>
                      {brandGroups.map((g) => (
                        <optgroup key={g.category} label={g.category}>
                          {g.brands.map((b) => <option key={b.brand} value={b.brand}>{b.brand} ({b.count} nearby)</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                </div>
                <Select label="Exact vertical" value={vertical} onChange={setVertical} options={VERTICAL_GROUPS.flatMap((g) => g.options)} />
                <p className="text-xs text-ink-muted">
                  We benchmark your site against <span className="text-accent">{comparableBrand || 'a comparable brand'}</span>’s real footprint — competitor discrimination,
                  daypart and lease corridors all adapt to that concept, so an independent gets the same scoring as a chain.
                </p>
              </div>
            )}
          </div>

          <div className="card p-4">
            <p className="mb-3 text-sm font-medium text-ink-text">Modules active for this vertical</p>
            <div className="flex flex-wrap gap-2">
              {MODULE_CHIPS.base.map((m) => {
                const on = chipActive(m.kind);
                return (
                  <span key={m.key} className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs ${on ? 'bg-ink-hover text-ink-text' : 'bg-ink-panel-2 text-ink-muted/50 line-through'}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${on ? (m.kind === 'new' ? 'bg-accent' : 'bg-verified') : 'bg-ink-border'}`} />
                    {m.label}
                    {m.kind === 'new' && on && <span className="text-[9px] text-accent">new</span>}
                  </span>
                );
              })}
            </div>
            <p className="mt-3 rounded-lg bg-accent/10 px-3 py-2 text-xs text-accent">
              ◆ Territory Guard, Lease Benchmark, Daypart Demand and White-Space run on every analysis — your outlet master (Section G) is loaded, so Territory Guard checks each candidate against your existing branches automatically. No extra input needed.
            </p>
          </div>
        </div>
      )}

      {/* STEP 2 — brand & requirements (dropdowns) */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="font-medium text-ink-muted">Completeness</span>
            <span className={completeness.pct >= 80 ? 'text-go' : 'text-caution'}>{completeness.pct}% / 80% gate</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-ink-panel-2">
            <div className={`h-full ${completeness.pct >= 80 ? 'bg-go' : 'bg-caution'}`} style={{ width: `${completeness.pct}%` }} />
          </div>
          {/* Name what's still missing so the gate isn't a stuck percentage with no explanation. */}
          {completeness.pct < 80 && completeness.missing.length > 0 && (
            <p className="-mt-1 text-xs text-caution">
              Add {completeness.missing.map((k) => SECTION_LABELS[k] ?? k).join(', ')} to reach the 80% gate.
            </p>
          )}
          {completeness.pct >= 80 && (
            <p className="-mt-1 text-xs text-go">Ready — the 80% gate is met. You can proceed.</p>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="text-sm font-medium text-ink-muted">Brand & concept</span>
              <input value={sections.a ?? ''} onChange={(e) => setSection('a', e.target.value)} placeholder="e.g. Affordable premium milk tea" className="field mt-1" />
            </label>
            <Select label="Target customer" value={sections.b ?? ''} onChange={(v) => setSection('b', v)} options={TARGET_CUSTOMER} />
            <Select label="Catchment income band" value={sections.b2 ?? ''} onChange={(v) => setSection('b2', v)} options={INCOME_BAND} placeholder="Optional…" />
            <Select label="Format & footprint" value={sections.c ?? ''} onChange={(v) => setSection('c', v)} options={FOOTPRINT} />
            <label className="block">
              <span className="text-sm font-medium text-ink-muted">Unit economics</span>
              <input value={sections.d ?? ''} onChange={(e) => setSection('d', e.target.value)} placeholder="e.g. Avg ticket ₱145" className="field mt-1" />
            </label>
            <Select label="Expansion goals" value={sections.e ?? ''} onChange={(v) => setSection('e', v)} options={EXPANSION_GOAL} />
            <Select label="Site preferences" value={sections.f ?? ''} onChange={(v) => setSection('f', v)} options={SITE_PREFERENCE} />
            <Select label="Governance & consent" value={sections.k ?? ''} onChange={(v) => setSection('k', v)} options={CONSENT} placeholder="Consent…" />

            {/* Category-conditional fields (QA v6) — shown only when the vertical needs them. */}
            {showLandField && (
              <SelectOrManual label="Land parcel / lot & frontage" value={sections.land ?? ''} onChange={(v) => setSection('land', v)} options={LAND_PARCEL} placeholder="Parcel requirement…" />
            )}
            {showMallField && (
              <SelectOrManual label="Target mall tier" value={sections.mall ?? ''} onChange={(v) => setSection('mall', v)} options={MALL_TIER} placeholder="Mall tier…" />
            )}
            {showUnitField && (
              <SelectOrManual label="Capacity (chairs / machines / lines)" value={sections.units ?? ''} onChange={(v) => setSection('units', v)} options={SERVICE_UNITS} placeholder="Units…" />
            )}
          </div>
        </div>
      )}

      {/* STEP 3 — outlets */}
      {step === 2 && (
        <div className="card p-5">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-ink-text">Existing outlets (your current branches)</p>
              <p className="text-xs text-ink-muted">Add each branch and <span className="text-accent">pin its exact spot on the map</span> (📍) — the address is a label for your reference. Pinning powers Territory Guard.</p>
            </div>
            <label className="btn-ghost cursor-pointer text-xs">Upload CSV<input type="file" accept=".csv" onChange={onCsv} className="hidden" /></label>
          </div>
          <div className="space-y-2">
            {outlets.map((o, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-lg bg-ink-panel-2 p-2">
                <input placeholder="Branch name" value={o.outletName} onChange={(e) => setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, outletName: e.target.value } : x)))} className="field col-span-3 px-2 py-1.5 text-sm" />
                <select value={o.format} onChange={(e) => setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, format: e.target.value } : x)))} className="field col-span-2 px-2 py-1.5 text-sm">
                  {OUTLET_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <input placeholder="Address (label)" value={o.address} onChange={(e) => setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} onBlur={() => geocodeOutlet(i)} className="field col-span-3 px-2 py-1.5 text-sm" />
                <input placeholder="Sales ₱" value={o.monthlySalesPhp} onChange={(e) => setOutlets((cs) => cs.map((x, j) => (j === i ? { ...x, monthlySalesPhp: e.target.value } : x)))} className="field col-span-2 px-2 py-1.5 text-sm" />
                <div className="col-span-2 flex items-center gap-2 text-xs">
                  <button type="button" onClick={() => setPinTarget({ kind: 'outlet', index: i })} className="rounded border border-ink-border px-1.5 py-1 text-[11px] text-accent hover:bg-ink-hover" title="Pin on map">📍 Pin</button>
                  {o.geocoding ? <span className="text-ink-muted">locating…</span> : o.lat && o.lon ? <span className="text-go">✓</span> : <span className="text-ink-muted">—</span>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setOutlets((cs) => [...cs, { outletName: '', format: 'inline', address: '', lat: '', lon: '', monthlySalesPhp: '' }])} className="mt-2 text-sm text-accent hover:underline">+ Add a branch</button>
        </div>
      )}

      {/* STEP 4 — candidates */}
      {step === 3 && (
        <div className="card p-5">
          <p className="mb-1 text-sm font-medium text-ink-text">Candidate sites to evaluate</p>
          <p className="mb-3 text-xs text-ink-muted"><span className="text-accent">Pin the exact spot on the map</span> (📍) for each site — the address is a label for your reference.</p>
          <div className="space-y-2">
            {candidates.map((c, i) => (
              <div key={i} className="grid grid-cols-12 items-center gap-2 rounded-lg bg-ink-panel-2 p-2">
                <input placeholder="Label" value={c.label} onChange={(e) => setCandidates((cs) => cs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className="field col-span-3 px-2 py-1.5 text-sm" />
                <input placeholder="Address" value={c.address} onChange={(e) => setCandidates((cs) => cs.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))} onBlur={() => geocodeCandidate(i)} className="field col-span-4 px-2 py-1.5 text-sm" />
                <select value={c.siteType} onChange={(e) => setCandidates((cs) => cs.map((x, j) => (j === i ? { ...x, siteType: e.target.value } : x)))} className="field col-span-2 px-2 py-1.5 text-sm">
                  {OUTLET_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <div className="col-span-3 flex items-center gap-2 text-xs">
                  <button type="button" onClick={() => setPinTarget({ kind: 'candidate', index: i })} className="rounded border border-ink-border px-1.5 py-1 text-[11px] text-accent hover:bg-ink-hover" title="Pin on map">📍 Pin</button>
                  {c.geocoding ? <span className="text-ink-muted">locating…</span> : c.lat && c.lon ? <span className="text-go">✓ located</span> : <span className="text-ink-muted">enter address</span>}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setCandidates((cs) => [...cs, { label: '', address: '', city: '', lat: '', lon: '', siteType: 'inline' }])} className="mt-2 text-sm text-accent hover:underline">+ Add another site</button>
        </div>
      )}

      {error && <p className="text-sm text-nogo">{error}</p>}

      {/* Map-pin modal */}
      {pinTarget && (
        <LocationPicker
          title={pinTarget.kind === 'outlet' ? 'Pin this outlet on the map' : 'Pin this candidate site on the map'}
          initial={
            pinTarget.kind === 'outlet'
              ? { lat: Number(outlets[pinTarget.index]?.lat) || undefined, lon: Number(outlets[pinTarget.index]?.lon) || undefined }
              : { lat: Number(candidates[pinTarget.index]?.lat) || undefined, lon: Number(candidates[pinTarget.index]?.lon) || undefined }
          }
          onClose={() => setPinTarget(null)}
          onPick={(loc) => {
            if (pinTarget.kind === 'outlet') {
              setOutlets((cs) => cs.map((x, j) => (j === pinTarget.index ? { ...x, lat: String(loc.lat), lon: String(loc.lon), address: loc.address ?? x.address } : x)));
            } else {
              setCandidates((cs) => cs.map((x, j) => (j === pinTarget.index ? { ...x, lat: String(loc.lat), lon: String(loc.lon), address: loc.address ?? x.address, city: x.city || (loc.address?.split(',')[1]?.trim() ?? '') } : x)));
            }
          }}
        />
      )}

      {/* nav */}
      <div className="flex items-center justify-between">
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="btn-ghost disabled:opacity-40">← Back</button>
        {step < 3 ? (
          <button onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="btn-accent disabled:opacity-50">Next →</button>
        ) : (
          <button onClick={submit} disabled={!gateMet || submitting || !bizReady} className="btn-accent disabled:opacity-50">{submitting ? 'Submitting…' : 'Submit & run'}</button>
        )}
      </div>
    </div>
  );
}
