'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Franchise Screening — the pre-site decision tool. A buyer sets budget (+ optional floor
 * area) and gets a ranked, comparable shortlist of franchise brands from the standardized
 * requirements matrix. Answers "given my money and my space, which brands should I even
 * consider?" before any site question. Truth Layer chips travel with every brand.
 *
 * The full brand set is fetched ONCE (server ranks it for a neutral budget); all filtering,
 * re-ranking and sorting then happen live in the browser, so changing budget / space /
 * vertical / tier / truth / sort updates the table instantly with no round-trip.
 */
interface ScreenedBrand {
  brand: string;
  category: string | null;
  vertical: string | null;
  franchisor: string | null;
  investment: { min: number; max: number } | null;
  franchiseFee: { min: number; max: number } | null;
  minSqm: number | null;
  payback: { min: number; max: number; estimated: boolean } | null;
  truthLayer: string | null;
  confidence: number | null;
  fitScore: number;
  reasons: string[];
  overBudget: boolean;
  overSpace: boolean;
  source: string | null;
  dataset: string | null;     // "PFA" for PFA-directory imports, else null (original catalogue)
  memberType: string | null;  // "supplier" for PFA Allied members, else null (a franchise)
}

// Demo defaults so the page shows a full ranked table on first open.
const DEMO_BUDGET = '2M';
const DEMO_SPACE = '80';

const VERTICALS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All verticals' },
  { value: 'fnb_qsr', label: 'QSR / Fast food' },
  { value: 'fnb_cafe', label: 'Café' },
  { value: 'fnb_bakery', label: 'Bakery' },
  { value: 'convenience', label: 'Convenience' },
  { value: 'services_salon', label: 'Salon' },
  { value: 'services_spa', label: 'Spa' },
  { value: 'services_laundry', label: 'Laundry' },
  { value: 'services_fitness', label: 'Fitness' },
  { value: 'education', label: 'Education' },
  { value: 'pharmacy', label: 'Pharmacy' },
  { value: 'remittance', label: 'Remittance' },
];

// Preset options for the budget + floor-area dropdowns (a custom typed value is still allowed).
const BUDGET_PRESETS = ['500K', '1M', '2M', '5M', '10M', '20M', '50M'];
const SPACE_PRESETS = ['20', '40', '60', '80', '120', '200', '350'];

type TierFilter = 'all' | 'entry' | 'mid' | 'institutional';
type TruthFilter = 'all' | 'verified' | 'assumed' | 'projected';
type SourceFilter = 'all' | 'pfa' | 'existing';
type SortKey = 'fit' | 'investment' | 'payback' | 'space';

// Page-size options for the results table (default 50, the max shown at once).
const PAGE_SIZES = [10, 20, 30, 50];
const DEFAULT_PAGE_SIZE = 50;

// A brand's provenance for the Source filter: PFA-directory import vs the original catalogue.
function sourceOf(b: ScreenedBrand): 'pfa' | 'existing' {
  return (b.dataset ?? '').toUpperCase() === 'PFA' ? 'pfa' : 'existing';
}
function isSupplier(b: ScreenedBrand): boolean {
  return (b.memberType ?? '').toLowerCase() === 'supplier';
}

function fmtPhp(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1e6) return `₱${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `₱${Math.round(n / 1e3)}K`;
  return `₱${n.toLocaleString()}`;
}
function fmtRange(r: { min: number; max: number } | null): string {
  if (!r) return '—';
  return r.min === r.max ? fmtPhp(r.min) : `${fmtPhp(r.min)}–${fmtPhp(r.max)}`;
}
// Round payback to one decimal so a months→years conversion doesn't print "0.6666…".
function r1(n: number): string { return Number.isInteger(n) ? String(n) : n.toFixed(1); }
function fmtPayback(p: { min: number; max: number; estimated: boolean } | null): string {
  if (!p) return '—';
  const body = p.min === p.max ? r1(p.min) : `${r1(p.min)}–${r1(p.max)}`;
  return `${body} yr${p.estimated ? ' (est.)' : ''}`;
}
function tierKey(min: number | null | undefined): TierFilter | null {
  if (min == null) return null;
  if (min <= 600_000) return 'entry';
  if (min <= 6_000_000) return 'mid';
  return 'institutional';
}
function tierBadge(min: number | null | undefined): { label: string; cls: string } | null {
  const k = tierKey(min);
  if (k === 'entry') return { label: 'Entry', cls: 'bg-go/15 text-go' };
  if (k === 'mid') return { label: 'Mid', cls: 'bg-accent/15 text-accent' };
  if (k === 'institutional') return { label: 'Institutional', cls: 'bg-projected/20 text-projected' };
  return null;
}
function truthCls(t: string | null): string {
  const v = (t ?? '').toLowerCase();
  if (v === 'verified') return 'tl-chip tl-verified';
  if (v === 'assumed') return 'tl-chip tl-assumed';
  return 'tl-chip tl-projected';
}
function parseBudget(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/[₱,\s]/g, '');
  if (!t) return null;
  const m = t.match(/^([\d.]+)(m|k|b)?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2] === 'm') n *= 1e6; else if (m[2] === 'k') n *= 1e3; else if (m[2] === 'b') n *= 1e9;
  return n;
}

/**
 * A preset dropdown that ALSO allows a custom value. The <select> shows the presets plus
 * an "Any / no limit" option and an "Other…" option; choosing "Other…" reveals a text box.
 * This makes the options visibly a dropdown (not just a datalist hint) while keeping free entry.
 */
function PresetField({
  label, hint, value, onChange, presets, suffix,
}: {
  label: string; hint: string; value: string; onChange: (v: string) => void; presets: string[]; suffix?: string;
}) {
  const isPreset = value === '' || presets.includes(value);
  const [custom, setCustom] = useState(!isPreset);
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink-text">{label}</span>
      {custom ? (
        <div className="mt-1 flex gap-2">
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type a value"
            className="field"
          />
          <button type="button" onClick={() => { setCustom(false); onChange(''); }} className="btn-ghost shrink-0 text-xs">Presets</button>
        </div>
      ) : (
        <select
          value={presets.includes(value) ? value : ''}
          onChange={(e) => { if (e.target.value === '__other__') { setCustom(true); onChange(''); } else onChange(e.target.value); }}
          className="field mt-1"
        >
          <option value="">Any</option>
          {presets.map((p) => <option key={p} value={p}>{p}{suffix ?? ''}</option>)}
          <option value="__other__">Other…</option>
        </select>
      )}
      <span className="mt-1 block text-[11px] text-ink-muted">{hint}</span>
    </label>
  );
}

// Re-derive the fit read for a brand against the CURRENT budget/space, client-side, so the
// ranking and the "within reach" flags update live. Mirrors the server's scoreBrand logic.
function localFit(b: ScreenedBrand, budgetPhp: number | null, floorAreaSqm: number | null) {
  // Suppliers/Allied members are not franchise offers — keep them pinned at 0 (bottom of
  // the list) regardless of budget/space, mirroring the server.
  if (isSupplier(b)) {
    return { fitScore: 0, reasons: ['Allied member / supplier — a vendor, not a franchise offer'], overBudget: false, overSpace: false };
  }
  let score = 50;
  const reasons: string[] = [];
  let overBudget = false, overSpace = false;
  const inv = b.investment;
  if (budgetPhp != null && inv) {
    if (inv.min > budgetPhp) { overBudget = true; score -= 45; reasons.push(`Entry investment (${fmtPhp(inv.min)}) is above your budget`); }
    else if (inv.max <= budgetPhp) { score += 25; reasons.push('Comfortably within budget'); }
    else { score += 12; reasons.push('Within budget at the entry format'); }
  } else if (budgetPhp != null && !inv) { score -= 6; reasons.push('Investment not stated — verify'); }
  if (floorAreaSqm != null && b.minSqm != null) {
    if (b.minSqm > floorAreaSqm) { overSpace = true; score -= 30; reasons.push(`Needs ~${b.minSqm} sqm — more than your ${floorAreaSqm} sqm`); }
    else { score += 15; reasons.push(`Fits your space (needs ~${b.minSqm} sqm)`); }
  } else if (floorAreaSqm != null && b.minSqm == null) { score -= 4; reasons.push('Minimum space not stated'); }
  if (b.payback) { if (b.payback.min <= 2) score += 6; else if (b.payback.min <= 3.5) score += 3; if (!b.payback.estimated) score += 3; }
  if (b.confidence != null) score += Math.round((b.confidence - 70) / 10);
  return { fitScore: Math.max(0, Math.min(100, Math.round(score))), reasons, overBudget, overSpace };
}

/**
 * Brand search with live auto-suggest. Typing filters the table immediately (via the shared
 * `search` state); the dropdown is an accelerator that lets the user jump straight to one
 * brand. Suggestions rank exact → prefix → substring matches, show the brand's category and a
 * PFA/Supplier badge for context, highlight the typed fragment, and support full keyboard use
 * (↑/↓ to move, Enter to pick, Esc to close). Clicking outside closes it.
 */
interface SuggestBrand { brand: string; category: string | null; dataset: string | null; memberType: string | null }

function rankSuggestions(brands: SuggestBrand[], query: string, limit = 8): SuggestBrand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: Array<{ b: SuggestBrand; rank: number }> = [];
  for (const b of brands) {
    const name = b.brand.toLowerCase();
    const cat = (b.category ?? '').toLowerCase();
    let rank = -1;
    if (name === q) rank = 0;                     // exact
    else if (name.startsWith(q)) rank = 1;        // name prefix
    else if (name.includes(q)) rank = 2;          // name substring
    else if (cat.includes(q)) rank = 3;           // category match
    if (rank >= 0) scored.push({ b, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.b.brand.localeCompare(b.b.brand));
  return scored.slice(0, limit).map((s) => s.b);
}

/** Split a label around the first case-insensitive match of `q` so the match can be bolded. */
function highlight(label: string, q: string) {
  const i = q ? label.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <span className="font-semibold text-accent">{label.slice(i, i + q.length)}</span>
      {label.slice(i + q.length)}
    </>
  );
}

function BrandAutocomplete({
  value, onChange, brands, resultCount,
}: {
  value: string;
  onChange: (v: string) => void;
  brands: SuggestBrand[];
  resultCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // highlighted suggestion index
  const boxRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => rankSuggestions(brands, value), [brands, value]);

  // Close on outside click.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  // Keep the active index in range as suggestions change.
  useEffect(() => { setActive(0); }, [value]);

  function choose(brand: string) {
    onChange(brand);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { setOpen(true); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { if (open && suggestions[active]) { e.preventDefault(); choose(suggestions[active].brand); } }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  const showDrop = open && value.trim().length > 0 && suggestions.length > 0;

  return (
    <div ref={boxRef} className="relative">
      <label className="block">
        <span className="text-sm font-medium text-ink-text">Search a brand</span>
        <div className="relative mt-1">
          <input
            value={value}
            onChange={(e) => { onChange(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Start typing a brand… (e.g. Jollibee, Milk Tea, KFC)"
            className="field w-full pr-9"
            role="combobox"
            aria-expanded={showDrop}
            aria-autocomplete="list"
            autoComplete="off"
          />
          {value && (
            <button
              type="button"
              onClick={() => { onChange(''); setOpen(false); }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-ink-muted hover:text-ink-text"
            >
              ✕
            </button>
          )}
        </div>
      </label>

      {showDrop && (
        <ul
          role="listbox"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-auto rounded-lg border border-ink-border bg-ink-panel-2 py-1 shadow-xl"
        >
          {suggestions.map((s, i) => {
            const supplier = (s.memberType ?? '').toLowerCase() === 'supplier';
            const pfa = (s.dataset ?? '').toUpperCase() === 'PFA';
            return (
              <li
                key={s.brand}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => { e.preventDefault(); choose(s.brand); }}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${i === active ? 'bg-ink-border/60' : ''}`}
              >
                <span className="min-w-0">
                  <span className="text-ink-text">{highlight(s.brand, value)}</span>
                  {s.category && <span className="ml-2 truncate text-[11px] text-ink-muted">{s.category}</span>}
                </span>
                {supplier
                  ? <span className="pill bg-ink-panel-2 text-ink-muted shrink-0 text-[10px]">Supplier</span>
                  : pfa ? <span className="pill pill-new shrink-0 text-[10px]">PFA</span> : null}
              </li>
            );
          })}
          <li className="border-t border-ink-border px-3 py-1.5 text-[11px] text-ink-muted">
            {resultCount} match{resultCount === 1 ? '' : 'es'} in the table · ↑↓ to navigate, Enter to pick
          </li>
        </ul>
      )}
    </div>
  );
}

export function FranchiseScreeningView() {
  const [budget, setBudget] = useState(DEMO_BUDGET);
  const [space, setSpace] = useState(DEMO_SPACE);
  const [vertical, setVertical] = useState('');
  const [tier, setTier] = useState<TierFilter>('all');
  const [truth, setTruth] = useState<TruthFilter>('all');
  const [source, setSource] = useState<SourceFilter>('all');
  const [search, setSearch] = useState('');
  const [hideOutOfReach, setHideOutOfReach] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>('fit');

  // Pagination — max 50 shown at once, with a 10/20/30/50 page-size dropdown.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allBrands, setAllBrands] = useState<ScreenedBrand[]>([]);

  // Fetch the full brand set ONCE (server ranks with no budget, so we get everything).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/screening', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ budgetPhp: null, floorAreaSqm: null, vertical: null, limit: 500 }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error?.message ?? 'Screening failed');
        if (!cancelled) setAllBrands(json.data.brands as ScreenedBrand[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Something went wrong');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const budgetPhp = parseBudget(budget);
  const floorAreaSqm = space.trim() ? Number(space.replace(/[^\d.]/g, '')) : null;

  // Live-derived, filtered, sorted list. Recomputes instantly on any control change.
  const rows = useMemo(() => {
    let list = allBrands.map((b) => ({ ...b, ...localFit(b, budgetPhp, floorAreaSqm ?? null) }));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((b) => b.brand.toLowerCase().includes(q) || (b.category ?? '').toLowerCase().includes(q));
    if (source !== 'all') list = list.filter((b) => sourceOf(b) === source);
    if (vertical) list = list.filter((b) => b.vertical === vertical);
    if (tier !== 'all') list = list.filter((b) => tierKey(b.investment?.min) === tier);
    if (truth !== 'all') list = list.filter((b) => (b.truthLayer ?? '').toLowerCase() === truth);
    if (hideOutOfReach) list = list.filter((b) => !b.overBudget && !b.overSpace && !isSupplier(b));
    const cmp: Record<SortKey, (a: ScreenedBrand, b: ScreenedBrand) => number> = {
      fit: (a, b) => b.fitScore - a.fitScore || (a.investment?.min ?? Infinity) - (b.investment?.min ?? Infinity),
      investment: (a, b) => (a.investment?.min ?? Infinity) - (b.investment?.min ?? Infinity),
      payback: (a, b) => (a.payback?.min ?? Infinity) - (b.payback?.min ?? Infinity),
      space: (a, b) => (a.minSqm ?? Infinity) - (b.minSqm ?? Infinity),
    };
    return [...list].sort(cmp[sortKey]);
  }, [allBrands, budgetPhp, floorAreaSqm, vertical, tier, truth, source, search, hideOutOfReach, sortKey]);

  const affordable = rows.filter((b) => !isSupplier(b) && !b.overBudget && !b.overSpace).length;

  // Pagination math — clamp the page and slice the current window.
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);
  const firstRow = rows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastRow = Math.min(safePage * pageSize, rows.length);

  // Any filter/sort/page-size change resets to page 1 so the user isn't stranded on an
  // empty page.
  useEffect(() => { setPage(1); }, [budget, space, vertical, tier, truth, source, search, hideOutOfReach, sortKey, pageSize]);

  function clearAll() {
    setBudget(''); setSpace(''); setVertical(''); setTier('all'); setTruth('all');
    setSource('all'); setSearch(''); setHideOutOfReach(false); setSortKey('fit');
  }

  return (
    <div className="space-y-5">
      {/* Primary inputs — visible preset dropdowns with an "Other…" free-type escape. */}
      <div className="card p-6">
        {/* Brand quick-find with auto-suggest — sits above everything so a user who knows the
            brand they want can jump straight to it; typing also filters the table live. */}
        <div className="mb-4 border-b border-ink-border pb-4">
          <BrandAutocomplete value={search} onChange={setSearch} brands={allBrands} resultCount={rows.length} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <PresetField
            label="Your budget"
            hint="Total you can commit. Pick a preset or choose Other… to type (e.g. 1.5M)."
            value={budget}
            onChange={setBudget}
            presets={BUDGET_PRESETS}
          />
          <PresetField
            label="Available floor area (sqm)"
            hint="Optional. Square metres you have or can lease."
            value={space}
            onChange={setSpace}
            presets={SPACE_PRESETS}
            suffix=" sqm"
          />
          <label className="block">
            <span className="text-sm font-medium text-ink-text">Vertical</span>
            <select value={vertical} onChange={(e) => setVertical(e.target.value)} className="field mt-1">
              {VERTICALS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          </label>
        </div>

        {/* Secondary filters — all live. */}
        <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-ink-border pt-4">
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Source</span>
            <select value={source} onChange={(e) => setSource(e.target.value as SourceFilter)} className="field mt-1 w-40">
              <option value="all">All sources</option>
              <option value="pfa">PFA directory</option>
              <option value="existing">Original catalogue</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Capital tier</span>
            <select value={tier} onChange={(e) => setTier(e.target.value as TierFilter)} className="field mt-1 w-40">
              <option value="all">All tiers</option>
              <option value="entry">Entry (≤₱600K)</option>
              <option value="mid">Mid (≤₱6M)</option>
              <option value="institutional">Institutional</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Truth Layer</span>
            <select value={truth} onChange={(e) => setTruth(e.target.value as TruthFilter)} className="field mt-1 w-40">
              <option value="all">Any</option>
              <option value="verified">Verified only</option>
              <option value="assumed">Assumed</option>
              <option value="projected">Projected</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Sort by</span>
            <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)} className="field mt-1 w-44">
              <option value="fit">Best fit</option>
              <option value="investment">Lowest investment</option>
              <option value="payback">Fastest payback</option>
              <option value="space">Smallest space</option>
            </select>
          </label>
          <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm text-ink-text">
            <input type="checkbox" checked={hideOutOfReach} onChange={(e) => setHideOutOfReach(e.target.checked)} className="h-4 w-4 accent-[#e0a568]" />
            Hide out-of-reach
          </label>
          <button onClick={clearAll} className="btn-ghost ml-auto pb-2 text-sm">Reset filters</button>
        </div>
        {error && <p className="mt-3 text-sm text-nogo">{error}</p>}
      </div>

      {/* Results */}
      {loading ? (
        <div className="card p-8 text-center text-sm text-ink-muted">Loading the franchise catalogue…</div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
            <span>
              {rows.length > 0 && <>Showing <span className="font-semibold text-ink-text">{firstRow}–{lastRow}</span> of </>}
              <span className="font-semibold text-ink-text">{rows.length}</span> brands
              {budgetPhp != null && <> · budget <span className="font-semibold text-ink-text">{fmtPhp(budgetPhp)}</span></>}
              {floorAreaSqm != null && <> · {floorAreaSqm} sqm</>}
            </span>
            <span className="pill pill-go">{affordable} within reach</span>
            <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
              Show
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="field w-20 py-1"
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              per page
            </label>
          </div>

          {rows.length === 0 ? (
            <div className="card p-8 text-center text-sm text-ink-muted">No brands match these filters. Try widening the budget or clearing a filter.</div>
          ) : (
            <div className="card overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-border bg-ink-panel-2 text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="px-3 py-2 font-medium">Fit</th>
                      <th className="px-3 py-2 font-medium">Brand</th>
                      <th className="px-3 py-2 font-medium">Tier</th>
                      <th className="px-3 py-2 font-medium">Total investment</th>
                      <th className="px-3 py-2 font-medium">Franchise fee</th>
                      <th className="px-3 py-2 font-medium">Min space</th>
                      <th className="px-3 py-2 font-medium">Payback</th>
                      <th className="px-3 py-2 font-medium">Truth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((b) => {
                      const supplier = isSupplier(b);
                      const badge = tierBadge(b.investment?.min);
                      const dim = b.overBudget || b.overSpace || supplier;
                      return (
                        <tr key={b.brand} className={`border-b border-ink-border align-top ${dim ? 'opacity-55' : ''}`}>
                          <td className="px-3 py-2"><span className="text-lg font-bold text-ink-text">{supplier ? '—' : b.fitScore}</span></td>
                          <td className="px-3 py-2">
                            <p className="font-medium text-ink-text">
                              {b.brand}
                              {sourceOf(b) === 'pfa' && !supplier && <span className="ml-2 pill pill-new align-middle text-[10px]">PFA</span>}
                            </p>
                            <p className="text-[11px] text-ink-muted">{b.category ?? b.vertical ?? ''}</p>
                            {b.reasons[0] && <p className={`mt-0.5 text-[11px] ${dim ? 'text-nogo' : 'text-go'}`}>{b.reasons[0]}</p>}
                          </td>
                          <td className="px-3 py-2">
                            {supplier
                              ? <span className="pill bg-ink-panel-2 text-ink-muted">Supplier</span>
                              : badge ? <span className={`pill ${badge.cls}`}>{badge.label}</span> : <span className="text-ink-muted">—</span>}
                          </td>
                          <td className="px-3 py-2 text-ink-text">{fmtRange(b.investment)}</td>
                          <td className="px-3 py-2 text-ink-text">{fmtRange(b.franchiseFee)}</td>
                          <td className="px-3 py-2 text-ink-text">{b.minSqm != null ? `${b.minSqm} sqm` : '—'}</td>
                          <td className="px-3 py-2 text-ink-text">{fmtPayback(b.payback)}</td>
                          <td className="px-3 py-2">{b.truthLayer ? <span className={truthCls(b.truthLayer)}>{b.truthLayer}{b.confidence != null ? ` ${b.confidence}%` : ''}</span> : <span className="text-ink-muted">—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Pagination controls */}
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-border px-3 py-3 text-sm">
                  <span className="text-ink-muted">Page <span className="font-semibold text-ink-text">{safePage}</span> of {totalPages}</span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setPage(1)} disabled={safePage === 1} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">« First</button>
                    <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage === 1} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">‹ Prev</button>
                    <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={safePage === totalPages} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">Next ›</button>
                    <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages} className="btn-ghost px-2 py-1 text-xs disabled:opacity-40">Last »</button>
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="text-[11px] text-ink-muted">
            Figures are franchisor-stated ranges parsed from the requirements matrix, each carrying its Truth Layer
            classification. Payback is normalized to years; “(est.)” marks a franchisor estimate. This screens which
            brands to consider — validate the shortlist, then run a site analysis on the winners. BSA sharpens the
            decision; your broker still closes the deal.
          </p>
        </>
      )}
    </div>
  );
}
