'use client';

import { fmtInt, fmtPeso } from '@/lib/util/format';
import { ZONAL_FLOOR_NOTE } from '@/lib/truth/guardrailCopy';
import type { TruthLayer } from '@/lib/truth/truthLayer';
import {
  buildSiteReportModel, tl, tk, fmtPct, ordinal, T_VERDICT, L_VERDICT,
  type SiteModulePayloads, type SiteReportMeta, type LeaseZonal, type ModuleSummaryModel,
} from '@/lib/modules/siteReportModel';
import { useState } from 'react';
import { FinalReportHero, FindingsList } from '@/components/FinalReport';
import { TruthChip, TruthLegend, StatusText } from '@/components/ui/Chips';
import { useRouter } from 'next/navigation';
import { TerritoryMap, type MapOutlet } from '@/components/TerritoryMap';
import { DaypartCurve, type DaypartData } from '@/components/DaypartCurve';
import { LeaseDistributionChart } from '@/components/LeaseDistributionChart';
import { GapsMap } from '@/components/GapsMap';
import { catchmentRadius } from '@/lib/modules/territoryMath';
import { daypartCurve } from '@/lib/modules/p2p3Math';
import { MIN_SAMPLE } from '@/lib/modules/leaseMath';
import { isPrimaryModule } from '@/lib/modules/verticalConfig';
import type { Vertical, ModuleKind } from '@prisma/client';

// Payload shapes, the Final Report model and shared display helpers live in a pure module so the
// exported site PDF renders EXACTLY what this screen shows (lib/modules/siteReportModel.ts).
export type { SiteModulePayloads, SiteReportMeta } from '@/lib/modules/siteReportModel';

const TABS = [
  { key: 'territory', label: 'Territory Guard' },
  { key: 'lease', label: 'Lease Benchmark' },
  { key: 'daypart', label: 'Daypart Demand' },
  { key: 'whitespace', label: 'White-Space' },
  { key: 'analysis', label: 'Final Report' }, // key stays `analysis` so URLs and PDFs don't break
] as const;

export type TabKey = (typeof TABS)[number]['key'];
export const TAB_KEYS: readonly TabKey[] = TABS.map((t) => t.key);

/** Status is never colour alone: icon + word (design v2). */
function Chip({ tone, children }: { tone: 'go' | 'caution' | 'nogo' | 'muted'; children: React.ReactNode }) {
  return <StatusText tone={tone}>{children}</StatusText>;
}

/** Design-system stat tile. A missing value renders the honest-gap state ("—", dashed), never 0. */
function Stat({ label, value, sub, truth }: { label: string; value: React.ReactNode; sub?: string; truth?: TruthKey }) {
  const empty = value == null || value === '—';
  return (
    <div className={`stat-tile ${empty ? 'stat-empty' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="stat-label">{label}</p>
        {truth && !empty && <TruthChip layer={truth} />}
      </div>
      <p className={`stat-value ${empty ? 'text-ink-muted' : ''}`}>{value ?? '—'}</p>
      {sub && <p className="text-label font-normal text-ink-muted">{sub}</p>}
    </div>
  );
}

type TruthKey = TruthLayer;

/** 0–23 → "12 NN", "3 PM", "6 AM" (Manila convention; no locale/ICU dependence). */
function fmtHour(h: number): string {
  const hr = ((Math.round(h) % 24) + 24) % 24;
  if (hr === 12) return '12 NN';
  if (hr === 0) return '12 MN';
  return hr < 12 ? `${hr} AM` : `${hr - 12} PM`;
}


/**
 * Contextual-read banner. Shown when a module ran for a format it isn't the primary read
 * for (e.g. Daypart for a fuel station, White-Space for a single café). The numbers are
 * real, but they carry less decision weight here — say so honestly rather than letting a
 * weak-context result read as authoritative.
 */
function ContextualNote({ module }: { module: string }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl border border-projected/50 bg-projected/10 px-4 py-3">
      <span className="text-projected" aria-hidden>ⓘ</span>
      <p className="text-label font-normal text-ink-muted">
        <span className="font-semibold text-projected">Contextual read.</span>{' '}
        {module} isn&apos;t the primary lens for this format — the figures below are real but
        carry lower weight in the decision. Lean on the format&apos;s primary modules for the call.
      </p>
    </div>
  );
}

/** Shown on a tab whose module has no stored result — an older run made before this module
 *  became a standing part of every analysis. Re-running the analysis populates it. */
function RerunNote({ module }: { module: string }) {
  return (
    <div className="card p-6">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-hover text-accent-text" aria-hidden>↻</span>
        <div>
          <p className="text-body font-semibold text-ink-text">{module} will populate on the next run</p>
          <p className="mt-1 text-body text-ink-muted">
            {module} is now part of every analysis, but this run was created before that change,
            so it has no stored result yet. Re-run this analysis (New Intake → same inputs →
            Submit &amp; run, or the run&apos;s re-run button) and the result will appear here.
          </p>
        </div>
      </div>
    </div>
  );
}

export function SiteIntelligenceTabs({
  site,
  outlets,
  payloads,
  vertical,
  verdict,
  runId,
  initialTab,
  report,
  leaseCorridors,
}: {
  site: { id: string; label: string; lat: number; lon: number; siteType: string | null };
  outlets: Array<{ id: string; name: string; lat: number; lon: number; format: string | null }>;
  payloads: SiteModulePayloads;
  vertical?: Vertical | null;
  /** The site's weighted-composite band (candidate_site.verdict) — drives the Final Report call. */
  verdict?: string | null;
  runId?: string;
  /** Tab to open on (from `?tab=`); defaults to the Final Report. */
  initialTab?: TabKey;
  /** Hero context for the Final Report (composite, rank, confidence, analysed time, truth mix). */
  report?: SiteReportMeta;
  /** Corridors the broker can re-benchmark against (registry corridors for the site's region +
   *  every corridor that has comps). Shown as a picker when the pipeline fell back to a proxy (F-40). */
  leaseCorridors?: string[];
}) {
  const [tab, setTab] = useState<TabKey>(initialTab ?? 'analysis');

  const mapOutlets: MapOutlet[] = outlets.map((o) => ({ id: o.id, name: o.name, lat: o.lat, lon: o.lon, catchmentM: catchmentRadius(o.format) }));

  // Is each module a primary (decision-grade) read for this format? Drives the "contextual"
  // badge. When vertical is unknown, treat everything as primary (no badge).
  const primary = (m: ModuleKind) => (vertical ? isPrimaryModule(vertical, m) : true);

  return (
    <div className="space-y-5">
      {/* Tab bar — underline tabs, roving tabindex, ← → to move; Truth Layer legend once per page. */}
      {/* Tabs never squeeze: they keep their natural width and the legend only sits beside them on
          wide screens (xl+); below that it drops underneath. No visible scrollbar. */}
      <div className="flex flex-col gap-x-6 gap-y-2 border-b border-ink-border xl:flex-row xl:items-end xl:justify-between">
        <div role="tablist" aria-label="Site modules" className="scrollbar-none -mb-px flex shrink-0 overflow-x-auto">
          {TABS.map((t) => {
            const has = t.key === 'analysis' || payloads[t.key] != null;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`tab-${t.key}`}
                aria-selected={active}
                aria-controls="site-tabpanel"
                tabIndex={active ? 0 : -1}
                onClick={() => setTab(t.key)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  e.preventDefault();
                  const i = TABS.findIndex((x) => x.key === tab);
                  const next = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length] : TABS[(i - 1 + TABS.length) % TABS.length];
                  setTab(next.key);
                  requestAnimationFrame(() => document.getElementById(`tab-${next.key}`)?.focus());
                }}
                className={`tab ${active ? 'tab-active' : ''}`}
              >
                {t.label}
                {!has && <span className="text-xs text-caution" title="No stored result — re-run to populate">≈</span>}
              </button>
            );
          })}
        </div>
        <TruthLegend className="shrink-0 pb-3.5 xl:justify-end" />
      </div>

      <div id="site-tabpanel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'territory' && <TerritoryTab site={site} outlets={mapOutlets} p={payloads.territory} primary={primary('territory')} />}
      {tab === 'lease' && <LeaseTab p={payloads.lease} primary={primary('lease')} siteId={site.id} corridors={leaseCorridors ?? []} />}
      {tab === 'daypart' && <DaypartTab p={payloads.daypart} primary={primary('daypart')} />}
      {tab === 'whitespace' && <WhiteSpaceTab p={payloads.whitespace} primary={primary('whitespace')} />}
      {tab === 'analysis' && <AnalysisTab payloads={payloads} primary={primary} verdict={verdict} report={report} onOpenTab={setTab} />}
      </div>
    </div>
  );
}

/* ---- Territory ---------------------------------------------------------- */

// Defensive render-level dedupe so runs saved before the compute-side fix still show
// each affected outlet once (keep the worst overlap). Also prevents duplicate React keys.
type AffectedOutlet = { outletName: string; overlapPct: number; distanceM: number };
function dedupeOutlets(list: AffectedOutlet[]): AffectedOutlet[] {
  const byName = new Map<string, AffectedOutlet>();
  for (const a of list) {
    const key = a.outletName.trim().toLowerCase();
    const prev = byName.get(key);
    if (!prev || a.overlapPct > prev.overlapPct) byName.set(key, a);
  }
  return [...byName.values()].sort((x, y) => y.overlapPct - x.overlapPct);
}
function TerritoryTab({ site, outlets, p, primary = true }: { site: { lat: number; lon: number; siteType: string | null }; outlets: MapOutlet[]; p: SiteModulePayloads['territory']; primary?: boolean }) {
  if (!p) return <RerunNote module="Territory Guard" />;
  // Validate against the map (not just ?? for null): an older run's payload can hold a verdict
  // value outside T_VERDICT, and T_VERDICT[unknown].tone would throw during SSR (React #329).
  const verdict = (p.verdict && p.verdict in T_VERDICT ? p.verdict : 'mixed') as keyof typeof T_VERDICT;
  const comps = p.mapCompetitors?.length ?? 0;
  const same = p.realCompetitors?.length ?? 0;
  const catchmentM = p.candidateCatchmentM ?? catchmentRadius(site.siteType);
  const mix = p.competitorMix;
  // A pre-tiering payload has no mix and no competitorCount. Say so plainly rather than
  // borrowing a different field — that is what produced "0% · 20 same-concept competitors".
  const tiered = mix != null || p.competitorCount != null;
  return (
    <div>
    {!primary && <ContextualNote module="Territory Guard" />}
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-3">
        <TerritoryMap
          outlets={outlets}
          competitors={(p.mapCompetitors?.length ? p.mapCompetitors : p.realCompetitors) ?? []}
          candidate={{ id: 'site', label: 'This site', lat: site.lat, lon: site.lon, catchmentM, verdict }}
        />
        {comps > 0 && (
          <p className="text-label font-normal text-ink-muted">
            {comps} nearby establishments from the database
            {mix ? ` · ${mix.direct} direct competitor${mix.direct === 1 ? '' : 's'} and ${mix.adjacent} adjacent format${mix.adjacent === 1 ? '' : 's'} inside the catchment` : same > 0 ? ` · ${same} same-concept` : ''}
            {p.conceptLabel ? `, matched against ${p.conceptLabel}` : ''}.
            {mix ? ' Grey dots are other businesses — shown for context only, not counted as competitors.' : ''}
          </p>
        )}
      </div>
      <div className="space-y-3">
        <div className="card p-5">
          <p className="overline">Territory call</p>
          <p className="mt-2 text-title"><Chip tone={T_VERDICT[verdict].tone}>{T_VERDICT[verdict].label}</Chip></p>
          {p.headlineSource === 'competitive' && (
            <p className="mt-2 text-xs text-ink-muted">Driven by competitive saturation, not your own branches.</p>
          )}
        </div>

        {/* Own-branch overlap — exact geometry over the recorded outlets; its Truth Layer is
            the outlets' own (typed-in branches are Assumed). */}
        <Stat
          label="Own-branch overlap"
          value={fmtPct(p.ownOutletOverlapPct ?? p.maxOverlapPct)}
          sub={
            (p.ownOutletOverlapPct ?? p.maxOverlapPct) == null
              ? 'not computed on this run — re-run the analysis'
              : (p.ownOutletOverlapPct ?? p.maxOverlapPct)! > 0
                ? 'with your nearest branch'
                : 'no own branch in this catchment'
          }
          truth={tk(tl(p.truth?.overlapPct, 'Assumed'))}
        />

        {/* Competitive saturation — the cannibalization-map signal. Projected. This is the
            read that stops a new brand in a saturated corridor from showing a false 0%. */}
        <Stat
          label="Competitive saturation"
          value={fmtPct(p.competitiveSaturationPct)}
          sub={
            !tiered
              ? 'competitor tiers not computed on this run — re-run the pipeline'
              : mix
                ? `${mix.direct} direct + ${mix.adjacent} adjacent in the catchment · weighted ${p.weightedCompetitorCount ?? mix.direct}`
                : `${p.competitorCount ?? 0} direct competitors in the catchment`
          }
          truth={tk(tl(p.truth?.competitiveSaturation, 'Projected'))}
        />

        <Stat label="Est. monthly cannibalization" value={fmtPeso(p.totalCannibalizedPhp)} sub="own-branch model" truth={tk(tl(p.truth?.cannibalizedPhp, 'Projected'))} />

        {/* Who you compete with — named from the Cannibalization Map. */}
        {p.competitorSet && p.competitorSet.competitors.length > 0 && (
          <div className="card p-5">
            <p className="mb-1 font-body text-title">Competes with</p>
            <p className="mb-2 text-label font-normal text-ink-muted">
              {p.competitorSet.subjectBrand
                ? `Competitor set for ${p.competitorSet.subjectBrand} — ${p.competitorSet.anchorBrand}-class rivals (${p.competitorSet.truthLayer})`
                : `Reference competitor set — ${p.competitorSet.anchorBrand}-class (${p.competitorSet.truthLayer})`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {p.competitorSet.competitors.slice(0, 10).map((c, i) => (
                <span key={`${c}-${i}`} className="rounded-chip border border-ink-border bg-ink-panel-2 px-2 py-0.5 text-label font-normal text-ink-text">{c}</span>
              ))}
            </div>
          </div>
        )}

        <div className="card p-5">
          <p className="mb-2 font-body text-title">Affected outlets</p>
          {(p.affectedOutlets?.length ?? 0) === 0 ? (
            <p className="text-body text-ink-muted">No existing branch overlaps this catchment.</p>
          ) : (
            <ul className="divide-y divide-ink-border text-body">
              {dedupeOutlets(p.affectedOutlets!).map((a, i) => (
                <li key={`${a.outletName}-${i}`} className="flex min-h-[44px] items-center justify-between gap-3"><span className="text-ink-text">{a.outletName}</span><span className="tabular-nums text-ink-muted">{a.overlapPct}% · {Math.round(a.distanceM)} m</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}

/* ---- Lease -------------------------------------------------------------- */
// Positional labels only — no price verdicts. L_VERDICT (all tones muted) lives in siteReportModel.
function LeaseTab({ p, primary = true, siteId, corridors = [] }: { p: SiteModulePayloads['lease']; primary?: boolean; siteId: string; corridors?: string[] }) {
  const router = useRouter();
  const [askingRent, setAskingRent] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [corridorBusy, setCorridorBusy] = useState(false);
  const [corridorMsg, setCorridorMsg] = useState<string | null>(null);

  /** F-40: re-benchmark this site against a corridor the broker picks (used when the pipeline fell
   *  back to a proxy corridor). Carries the current asking rent if one is entered. Choosing a real
   *  corridor drops the proxy/Projected flag server-side (the endpoint only keeps it for the same
   *  fallback corridor). */
  async function pickCorridor(corridor: string) {
    if (!corridor || corridor === p?.corridor) return;
    setCorridorBusy(true); setCorridorMsg(null);
    const rent = Number(askingRent);
    const siteTerms = Number.isFinite(rent) && rent > 0 ? { baseRentPhpSqm: rent } : {};
    try {
      const res = await fetch('/api/lease-benchmark', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateSiteId: siteId, corridor, format: p?.format ?? 'inline', siteTerms }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) { setCorridorMsg(json?.error?.message ?? 'Could not re-benchmark against that corridor.'); setCorridorBusy(false); return; }
      router.refresh();
    } catch { setCorridorMsg('The request failed — check your connection and try again.'); setCorridorBusy(false); }
  }

  /** Persist the asking rent: re-benchmarks the site server-side, stores the lease VALUE score and
   *  recomputes the site composite (POST /api/lease-benchmark). Until this runs, Lease does not
   *  count in the site score — the preview below is browser-only. */
  async function useInScore() {
    const rent = Number(askingRent);
    if (!p || !Number.isFinite(rent) || rent <= 0 || !p.corridor) return;
    setSaveState('saving'); setSaveMsg(null);
    try {
      const res = await fetch('/api/lease-benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ candidateSiteId: siteId, corridor: p.corridor, format: p.format ?? 'inline', siteTerms: { baseRentPhpSqm: rent } }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) { setSaveState('error'); setSaveMsg(json?.error?.message ?? 'Could not save the asking rent.'); return; }
      setSaveState('saved');
      setSaveMsg('Saved — the site score and the Final Report now include this rent.');
      router.refresh();
    } catch { setSaveState('error'); setSaveMsg('The request failed — check your connection and try again.'); }
  }
  if (!p) return <RerunNote module="Lease Benchmark" />;
  const v = (p.verdict && p.verdict in L_VERDICT ? p.verdict : 'insufficient_data') as keyof typeof L_VERDICT;
  const lZonalBand = ((p as SiteModulePayloads['lease'] & { zonal?: LeaseZonal }).zonal ?? null)?.band ?? null;
  const n = p.sampleSize ?? p.comps?.length ?? 0;

  // Corridor comp rents → let the user drop their asking rent in and see, client-side,
  // where it lands in the spread (delivers on the "add your asking rent" call-to-action
  // right here on the tab, no round-trip). Percentile = share of comps at or below it.
  const compRents = (p.comps ?? [])
    .map((c) => c.baseRentPhpSqm)
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x))
    .sort((a, b) => a - b);
  const median = compRents.length ? compRents[Math.floor((compRents.length - 1) / 2)] : null;
  const asking = Number(askingRent);
  const askingValid = askingRent.trim() !== '' && Number.isFinite(asking) && asking > 0;
  const enteredPct =
    askingValid && compRents.length
      ? Math.round((compRents.filter((r) => r <= asking).length / compRents.length) * 100)
      : null;

  // Asking bar in the chart only once the user types a rent; otherwise show the pure
  // corridor distribution (bars + median line) so the benchmark is visible immediately.
  const chartAsking = askingValid ? asking : null;

  return (
    <div className="space-y-4">
    {!primary && <ContextualNote module="Lease Benchmark" />}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div className="card p-5 sm:col-span-2">
        <p className="overline">Position vs {p.corridor ?? 'the'} corridor</p>
        {v === 'insufficient_data' ? (
          // H3 — not enough comparable leases to position a rent.
          <>
            <p className="mt-2 text-title text-ink-muted">— Not enough data yet</p>
            <p className="mt-1 text-body text-ink-text">
              Only {n} comparable lease{n === 1 ? '' : 's'} on {p.corridor ?? 'this corridor'}
            </p>
            <p className="mt-1 text-label font-normal text-ink-muted">
              We need at least {MIN_SAMPLE} to position a rent, so no percentile is shown.
              {lZonalBand ? ' The BIR zonal floor is still shown below for tax reference.' : ''}
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-title text-ink-text">
              {L_VERDICT[v].label}
              {v !== 'corridor_benchmark' && p.baseRentPercentile != null && (
                <span className="font-normal text-ink-muted"> · {ordinal(p.baseRentPercentile)} percentile of {n} comparable leases</span>
              )}
            </p>
            <p className="mt-1 text-label font-normal text-ink-muted">
              {v === 'corridor_benchmark'
                ? `The ${p.corridor ?? 'corridor'} benchmark from ${n} comparable lease${n === 1 ? '' : 's'}. Enter the asking rent below to see where it sits in the spread.`
                : 'Where the asking rent sits among comparable leases. A reference point, not a price opinion.'}
            </p>
          </>
        )}

        {/* Asking rent — preview in the browser, then save to count it in the site score. */}
        {compRents.length > 0 && (
          <div className="mt-4 border-t border-ink-border pt-4">
            <label htmlFor="asking-rent" className="field-label">Asking rent for this site (₱ per sqm / month)</label>
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <input
                id="asking-rent"
                type="number"
                inputMode="decimal"
                value={askingRent}
                onChange={(e) => setAskingRent(e.target.value)}
                placeholder={median != null ? `corridor median ≈ ${fmtInt(median)}` : 'e.g. 1450'}
                aria-describedby="asking-help"
                className="field w-56"
              />
              {enteredPct != null && (
                <span className="text-body text-ink-text" aria-live="polite">
                  → <span className="font-semibold">{ordinal(enteredPct)} percentile</span>{' '}
                  <span className="text-ink-muted">({enteredPct >= 60 ? 'above' : enteredPct <= 40 ? 'below' : 'around'} the corridor median)</span>
                </span>
              )}
            </div>
            <p id="asking-help" className="field-help mt-1.5">
              Saving updates the site score. It describes where the rent sits among {compRents.length} comparable leases — it is not a price opinion.
            </p>
            {enteredPct != null && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={useInScore}
                  disabled={saveState === 'saving'}
                  type="button"
                  className="btn-primary"
                  title="Store this asking rent so the Lease criterion counts in the site score"
                >
                  {saveState === 'saving' ? 'Saving…' : 'Save & use in score'}
                </button>
                {saveMsg && (
                  <span role={saveState === 'error' ? 'alert' : 'status'} className={`text-label font-normal ${saveState === 'error' ? 'text-nogo' : 'text-go'}`}>
                    {saveState === 'error' ? '✕ ' : '✓ '}{saveMsg}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <Stat
        label="Corridor"
        value={p.corridor ?? '—'}
        sub={
          p.flags?.includes('corridor_default_fallback')
            ? `No corridor matched this site's location — showing ${p.corridor ?? 'a reference'} comps as a proxy (Projected). Treat this benchmark as indicative only.`
            : `${n} comparable leases`
        }
        truth={p.flags?.includes('corridor_default_fallback') ? 'projected' : tk(tl(p.truth?.comps, 'Assumed'))}
      />
      {/* F-40: proxy corridor → let the broker pick the right one in a click and re-benchmark. */}
      {p.flags?.includes('corridor_default_fallback') && corridors.length > 0 && (
        <div className="rounded-control border border-ink-border bg-ink-panel-2 p-3 sm:col-span-2 lg:col-span-4">
          <label htmlFor="corridor-pick" className="field-label">Benchmark against a different corridor</label>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <select
              id="corridor-pick"
              className="field flex-1"
              defaultValue=""
              disabled={corridorBusy}
              onChange={(e) => { const v = e.target.value; if (v) pickCorridor(v); }}
            >
              <option value="" disabled>Choose the corridor closest to this site…</option>
              {corridors.filter((c) => c !== p.corridor).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {corridorBusy && <span className="text-body text-ink-muted">Re-benchmarking…</span>}
          </div>
          <p className="field-help mt-1.5">Picking the corridor nearest this site replaces the proxy with a real benchmark (no longer Projected).</p>
          {corridorMsg && <p role="alert" className="mt-1.5 text-body text-nogo">{corridorMsg}</p>}
        </div>
      )}
      <Stat label="Base-rent percentile" value={p.baseRentPercentile != null ? ordinal(p.baseRentPercentile) : '—'} sub="within corridor" truth="assumed" />
      {p.negotiatingRoomPhpSqm != null && (
        <Stat
          label="Distance from corridor median"
          value={`₱${fmtInt(Math.abs(p.negotiatingRoomPhpSqm))}/sqm`}
          sub={p.negotiatingRoomPct != null ? `${Math.abs(p.negotiatingRoomPct)}% ${p.negotiatingRoomPhpSqm > 0 ? 'above' : 'below'} median` : undefined}
        />
      )}
    </div>

    {/* Distribution chart — the corridor spread, shown automatically with the run.
        Reuses the same chart the standalone Lease Benchmark page uses. */}
    {compRents.length > 0 && (
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-body text-title">Corridor rent distribution (₱ / sqm / month)</h3>
          <span className="inline-flex items-center gap-2 text-label font-normal text-ink-muted">
            <TruthChip layer={tk(tl(p.truth?.comps, 'Assumed'))} /> n={compRents.length}
          </span>
        </div>
        <LeaseDistributionChart
          comps={compRents}
          median={median}
          p25={p.p25PhpSqm ?? null}
          p75={p.p75PhpSqm ?? null}
          asking={chartAsking}
          verdict={v}
        />
      </div>
    )}

    {/* BIR zonal value — a tax-reference FLOOR, never a market price or valuation (Grid guardrail). */}
    {lZonalBand && (
      <div className="card flex flex-col gap-2 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-body text-title">BIR zonal value · tax-reference floor</h3>
          <TruthChip layer={tk(tl(p.truth?.zonalBand, 'Verified'))} />
        </div>
        <p className="text-body font-semibold tabular-nums">
          {lZonalBand.classification ?? 'CR'} · {fmtPeso(lZonalBand.lowPhpSqm)} – {fmtPeso(lZonalBand.highPhpSqm)} /sqm
        </p>
        <p className="text-label font-normal text-ink-muted">{ZONAL_FLOOR_NOTE}</p>
      </div>
    )}

    {/* Comparable-leases table. */}
    {compRents.length > 0 && (
      <div className="card p-5">
        <h3 className="mb-3 font-body text-title">Comparable leases in {p.corridor ?? 'this corridor'} ({compRents.length})</h3>
        <div className="overflow-x-auto rounded-control border border-ink-border">
          <table className="w-full min-w-[420px] text-body">
            <thead>
              <tr className="table-head text-left">
                <th scope="col" className="px-3 py-2.5 font-semibold">#</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Base rent (₱/sqm/mo)</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">vs median</th>
              </tr>
            </thead>
            <tbody>
              {compRents.map((r, i) => {
                const delta = median != null ? r - median : null;
                return (
                  <tr key={i} className="border-t border-ink-border">
                    <td className="px-3 py-2 text-ink-muted">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-ink-text">₱{fmtInt(r)}</td>
                    <td className="px-3 py-2">
                      {delta == null ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <span className="text-ink-muted">
                          {delta > 0 ? '+' : ''}{fmtInt(delta)} ({delta > 0 ? 'above' : delta < 0 ? 'below' : 'at'})
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    )}
    </div>
  );
}

/* ---- Daypart ------------------------------------------------------------ */
function DaypartTab({ p, primary = true }: { p: SiteModulePayloads['daypart']; primary?: boolean }) {
  if (!p) return <RerunNote module="Daypart Demand" />;
  // Honest degrade: with no demographic (daytime-population) layer in range, the
  // daytime/residential split can't be derived. Show that plainly instead of a false
  // "0% daytime" curve. Seasonality below is corridor-modelled and still valid.
  const noData = p.noCatchmentData === true;
  const share = p.daytimeShare ?? 50;
  const officeLed = share >= 50;
  // Round for display so a 84.3 daytime share doesn't render its residential
  // complement as "15.700000000000003%" (floating-point remainder).
  const daytimePct = Math.round(share * 10) / 10;
  const residentialPct = Math.round((100 - share) * 10) / 10;
  const hourly = Array.isArray(p.hourly) && p.hourly.length === 24 ? p.hourly : daypartCurve(share);
  const data: DaypartData = { hourly, window: officeLed ? [11, 14] : [17, 20], windowMatchPct: p.windowMatchPct ?? 0 };
  return (
    <div>
    {!primary && <ContextualNote module="Daypart Demand" />}
    <div className="grid gap-5 lg:grid-cols-3">
      {noData ? (
        <div className="card p-5 lg:col-span-2">
          <p className="mb-2 font-body text-title">Demand across the day</p>
          <p className="text-body text-ink-muted">The daytime-vs-residential split for this catchment isn&apos;t derived — the demographic (daytime-population) layer isn&apos;t loaded for this location. Rather than show a false 0% curve, the app withholds the daypart mix here. Load a demographic layer to compute it. Seasonality (right) is modelled from corridor data and still applies.</p>
        </div>
      ) : (
        <div className="card p-5 lg:col-span-2">
          <p className="mb-3 font-body text-title">Demand across the day · {officeLed ? 'office-led (midday peak)' : 'residential (evening peak)'}</p>
          <DaypartCurve data={data} />
        </div>
      )}
      <div className="space-y-3">
        {noData ? (
          <Stat label="Catchment mix" value="Not derived" sub="demographic layer not loaded" truth="projected" />
        ) : (
          <>
        <Stat label="Window match" value={fmtPct(p.windowMatchPct)} sub="of demand falls inside the format's target window" truth="projected" />
        {p.windowMatchPct != null && (
          <p className="-mt-1 px-1 text-label">
            {p.windowMatchPct >= 60
              ? <StatusText tone="go">Strong window match</StatusText>
              : p.windowMatchPct >= 40
                ? <StatusText tone="caution">Partial window match</StatusText>
                : <StatusText tone="nogo">Weak window match</StatusText>}
          </p>
        )}
        <Stat label="Catchment mix" value={`${daytimePct}% daytime`} sub={`${residentialPct}% residential · ${officeLed ? 'office-led' : 'residential-led'}`} truth="projected" />
        <Stat label="Peak window" value={officeLed ? '11 AM – 2 PM' : '5 PM – 8 PM'} sub={p.peakHour != null ? `busiest hour ≈ ${fmtHour(p.peakHour)} · Manila time` : 'Manila time'} truth="projected" />
          </>
        )}

        {/* SEASONALITY — the "& Seasonality" half. Corridor demand swing across the NCR
            calendar (Christmas peak, Undas/Holy Week exodus dip) + vertical term-time note. */}
        {p.seasonality && (p.seasonality.peakSeason || p.seasonality.termTimeNote) && (
          <div className="card p-5">
            <div className="mb-1 flex items-center justify-between gap-2"><p className="stat-label">Seasonality</p><TruthChip layer="projected" /></div>
            {p.seasonality.peakSeason && (
              <p className="text-body text-ink-text">
                Peaks in <span className="font-semibold">{p.seasonality.peakSeason.label}</span>
                <span className="text-ink-muted"> (×{p.seasonality.peakSeason.low}–{p.seasonality.peakSeason.high})</span>
              </p>
            )}
            {p.seasonality.troughSeason && (
              <p className="text-body text-ink-text">
                Softest in <span className="font-semibold">{p.seasonality.troughSeason.label}</span>
                <span className="text-ink-muted"> (×{p.seasonality.troughSeason.low}–{p.seasonality.troughSeason.high})</span>
              </p>
            )}
            {p.seasonality.termTimeNote && (
              <p className="mt-1 text-label font-normal text-ink-muted">{p.seasonality.termTimeNote}</p>
            )}
            {p.corridor && <p className="mt-1 text-label font-normal text-ink-muted">Corridor: {p.corridor}</p>}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}

/* ---- White-Space -------------------------------------------------------- */
// Verdict bands for a recommended area, aligned with Territory Guard's cannibalization bands.
const WS_VERDICT = {
  open: { label: 'Open territory', tone: 'go' as const },
  workable: { label: 'Workable — light overlap', tone: 'caution' as const },
  contested: { label: 'Contested', tone: 'nogo' as const },
};

/**
 * White-Space = reverse Territory Guard. Instead of scoring the one candidate site, it scans
 * every barangay we hold data for and recommends the TOP areas where same-concept cannibalization
 * is low enough to enter (≤ threshold, default 40) while demand is high — each shown with the
 * actual businesses in the area, a verdict, and the same data Territory Guard displays.
 *
 * States: (1) no stored result → older run, prompt a re-run; (2) legacy `gaps` payload → prompt a
 * re-run so the recommendations recompute; (3) ran but no area ≤ threshold → honest "all contested"
 * note; (4) recommendations → map + ranked recommendation cards.
 */
function WhiteSpaceTab({ p }: { p: SiteModulePayloads['whitespace']; primary?: boolean }) {
  if (!p) return <RerunNote module="White-Space" />;
  // A run made before this rebuild has the old `gaps` shape and no `recommendations` key.
  if (p.recommendations == null) return <RerunNote module="White-Space" />;

  const recs = p.recommendations;
  const threshold = p.threshold ?? 40;
  const conceptLabel = p.concept?.label ?? 'this concept';
  const brand = p.competitorSet?.subjectBrand?.trim();
  const scanned = p.scanned ?? 0;

  if (recs.length === 0) {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-caution/15 text-caution" aria-hidden>!</span>
          <div>
            <p className="text-sm font-semibold text-ink-text">No low-cannibalization areas in current coverage</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              White-Space scanned {fmtInt(scanned)} barangay{scanned === 1 ? '' : 's'} for {conceptLabel} and
              found none with a cannibalization score at or below {threshold} — every area we hold data for is already
              contested by same-concept rivals or sits on top of one of your branches. That itself is a finding: this
              network&apos;s territory is saturated for this concept at the current data coverage.
            </p>
            <p className="mt-3 text-xs text-ink-muted">
              To surface fresh openings, widen coverage to barangays and corridors outside the mapped area, or relax the
              cannibalization threshold.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const mapPoints = recs
    .map((r) => ({
      rank: r.rank,
      label: [r.barangay ?? 'Unnamed area', r.city].filter(Boolean).join(', '),
      lat: r.lat ?? NaN,
      lon: r.lon ?? NaN,
      score: r.recommendationScore,
      reason: r.reason,
    }))
    .filter((g) => Number.isFinite(g.lat) && Number.isFinite(g.lon));

  return (
    <div className="space-y-4">
      {/* Header — what this tab now answers. */}
      <div className="card p-5">
        <p className="overline">Recommended locations</p>
        <p className="mt-1 text-lg font-bold text-ink-text">
          Top {recs.length} area{recs.length === 1 ? '' : 's'} to open{brand ? ` a ${brand} branch` : ''}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Areas with a cannibalization score of {threshold} or less for {conceptLabel} — low same-concept overlap and
          real demand. Scored the same way as Territory Guard, across {fmtInt(scanned)} barangay
          {scanned === 1 ? '' : 's'}. Cannibalization is Projected.
        </p>
      </div>

      {/* Overview map: every recommended area pinned by its rank. */}
      <div className="card p-5">
        <p className="mb-3 font-body text-title">Recommended areas · OpenStreetMap</p>
        {mapPoints.length > 0 ? (
          <GapsMap gaps={mapPoints} />
        ) : (
          <div className="rounded-lg border border-dashed border-ink-border p-4 text-center text-xs text-ink-muted">
            Re-run this analysis to attach barangay coordinates — the recommended areas will then plot on a map here.
          </div>
        )}
      </div>

      {/* Named competitor set — WHO these areas would compete with (same source as Territory Guard). */}
      {p.competitorSet && p.competitorSet.competitors.length > 0 && (
        <div className="card p-5">
          <p className="mb-1 font-body text-title">Competes with</p>
          <p className="mb-2 text-label font-normal text-ink-muted">
            {brand
              ? `Competitor set for ${brand} — ${p.competitorSet.anchorBrand}-class rivals (${p.competitorSet.truthLayer})`
              : `Reference competitor set — ${p.competitorSet.anchorBrand}-class (${p.competitorSet.truthLayer})`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {p.competitorSet.competitors.slice(0, 12).map((c, i) => (
              <span key={`${c}-${i}`} className="rounded-chip border border-ink-border bg-ink-panel-2 px-2 py-0.5 text-label font-normal text-ink-text">{c}</span>
            ))}
          </div>
        </div>
      )}

      {/* Ranked recommendation cards — Territory-Guard-style verdict + data + the real businesses there. */}
      <div className="space-y-3">
        {recs.map((r) => {
          const v = WS_VERDICT[r.verdict] ?? WS_VERDICT.workable;
          return (
            <div key={`${r.barangay}-${r.rank}`} className="card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-accent-on">{r.rank}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-ink-text">{r.barangay ?? 'Unnamed area'}</p>
                  {r.city && <p className="truncate text-xs text-ink-muted">{r.city}</p>}
                </div>
                <Chip tone={v.tone}>{v.label}</Chip>
              </div>

              {/* Data row — same fields Territory Guard shows, per area. */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Cannibalization" value={`${Math.round(r.cannibalizationPct)}%`} sub="lower is better" truth="projected" />
                <Stat
                  label="Same-concept nearby"
                  value={`${r.competitorMix.direct} direct`}
                  sub={`+ ${r.competitorMix.adjacent} adjacent in catchment`}
                />
                <Stat label="Population" value={fmtInt(r.population)} sub="catchment residents" truth="verified" />
                <Stat
                  label="Nearest own branch"
                  value={r.nearestOwnM == null ? 'None nearby' : `${fmtInt(r.nearestOwnM)} m`}
                  sub={r.nearestOwnM == null ? 'no self-cannibalization' : 'from your closest outlet'}
                />
              </div>

              {/* The actual businesses in the area — the "exact or similar businesses" to weigh. */}
              <div className="mt-4">
                <p className="overline mb-1.5">Businesses in the area</p>
                {r.nearbyBusinesses.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {r.nearbyBusinesses.map((b, i) => (
                      <span key={`${b}-${i}`} className="rounded-chip border border-ink-border bg-ink-panel-2 px-2 py-0.5 text-label font-normal text-ink-text">{b}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-label font-normal text-ink-muted">Open ground — no same-concept or adjacent businesses found in the catchment.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---- Analysis (combined final report) ----------------------------------- */
/**
 * The Analysis tab is a deterministic FINAL REPORT: it folds every figure already shown on the
 * Territory Guard, Lease Benchmark, Daypart Demand and White-Space tabs into one read-through
 * view. Nothing is recomputed and nothing is invented — each value is carried straight from the
 * persisted module_result payloads the other tabs render, with its Truth Layer kept in place.
 * Above it sits the AI write-up (retrieve-then-generate over exactly these figures), generated
 * one site per request and cached per site; see lib/ai/analysisReport.ts.
 */

/** One compact label → value row inside a report section, with an optional Truth-Layer tag. */
function ReportRow({ label, value, truth }: { label: string; value: React.ReactNode; truth?: TruthLayer }) {
  return (
    <div className="flex min-h-[48px] items-center justify-between gap-4 border-b border-ink-border/40 py-2 last:border-0">
      <span className="text-body text-ink-muted">{label}</span>
      <span className="text-right text-body font-medium text-ink-text">
        {value}
        {truth && <span className="ml-2 inline-flex align-middle"><TruthChip layer={truth} compact /></span>}
      </span>
    </div>
  );
}

/** A per-module section of the combined report: title, verdict chip, and its key figures. */
function ReportSection({
  title, tabKey, ran, verdict, verdictTone, contextual, children, onOpenTab,
}: {
  title: string; tabKey: TabKey; ran: boolean;
  verdict?: string; verdictTone?: 'go' | 'caution' | 'nogo' | 'muted';
  contextual?: boolean; children?: React.ReactNode;
  onOpenTab?: (tab: TabKey) => void;
}) {
  return (
    <div className="card flex flex-col p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-body text-title text-ink-text">{title}</h3>
        {ran && verdict ? <Chip tone={verdictTone ?? 'muted'}>{verdict}</Chip> : !ran ? <Chip tone="muted">Not run</Chip> : null}
      </div>
      {contextual && ran && (
        <p className="mt-1 text-label font-normal text-projected">Contextual read for this format — carries lower weight in the decision.</p>
      )}
      {ran ? (
        <div className="mt-3">{children}</div>
      ) : (
        <p className="mt-2 text-body text-ink-muted">This module has no stored result for this site — re-run the analysis to populate it.</p>
      )}
      {onOpenTab && (
        <button type="button" onClick={() => onOpenTab(tabKey)} className="link mt-auto min-h-tap self-start pt-3 text-left">Open {title} ›</button>
      )}
    </div>
  );
}

function AnalysisTab({
  payloads, primary, verdict, report, onOpenTab,
}: {
  payloads: SiteModulePayloads;
  primary: (m: ModuleKind) => boolean;
  verdict?: string | null;
  report?: SiteReportMeta;
  onOpenTab: (tab: TabKey) => void;
}) {
  // Export site PDF + Re-run analysis live in the site page header (design v2, PATCHES §1g).
  // The whole report comes from the shared model — the exported PDF renders the same object.
  const m = buildSiteReportModel({ payloads, verdict, isPrimary: primary, meta: report });

  return (
    <div className="space-y-5">
      {/* Final Report — the deterministic Proceed / Proceed with caution / No-Go call first, then what
          drove it. No AI, no external call; every finding traces to a module tab. */}
      <FinalReportHero
        summary={m.summary}
        coverage={m.coverageText}
        confidence={m.meta.confidence ?? null}
        composite={m.meta.composite ?? null}
        rank={m.meta.rank ?? null}
        total={m.meta.total ?? null}
        analysedAt={m.meta.analysedAt ?? null}
        truthPct={m.truthPct}
        limited={m.limited}
      />
      {m.summary.findings.length > 0 && (
        <FindingsList findings={m.summary.findings} keywords={m.summary.keywords} figures={m.figures} onOpenTab={onOpenTab} />
      )}

      <h2 className="pt-2 text-h2">Module summaries</h2>
      <div className="grid gap-5 lg:grid-cols-2">
        {m.modules.map((mod) => <ModuleSummaryCard key={mod.key} mod={mod} onOpenTab={onOpenTab} />)}
      </div>

      <p className="px-1 text-label font-normal text-ink-muted">{m.footnote}</p>
    </div>
  );
}

/** One module summary card rendered from the shared model. */
function ModuleSummaryCard({ mod, onOpenTab }: { mod: ModuleSummaryModel; onOpenTab: (tab: TabKey) => void }) {
  return (
    <ReportSection
      title={mod.title}
      tabKey={mod.key}
      onOpenTab={onOpenTab}
      ran={mod.ran}
      verdict={mod.status?.label}
      verdictTone={mod.status?.tone}
      contextual={mod.contextual}
    >
      <div>
        {mod.lead && <p className="mb-2 text-label font-normal text-ink-muted">{mod.lead}</p>}
        {mod.rows.map((r, i) => (
          <ReportRow key={`${r.label}-${i}`} label={r.label} value={r.value} truth={r.truth} />
        ))}
        {mod.ran && mod.emptyText && <p className="mt-2 text-body text-ink-muted">{mod.emptyText}</p>}
      </div>
    </ReportSection>
  );
}

function NoData({ module, note }: { module: string; note?: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-body text-ink-muted">{note ?? `${module} did not run for this site's vertical.`}</p>
    </div>
  );
}
