'use client';

import { manilaShortStamp } from '@/lib/util/manilaTime';
import { LEASE_POSITION_LABEL, ZONAL_FLOOR_NOTE } from '@/lib/truth/guardrailCopy';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TerritoryMap, type MapOutlet } from '@/components/TerritoryMap';
import { DaypartCurve, type DaypartData } from '@/components/DaypartCurve';
import { LeaseDistributionChart } from '@/components/LeaseDistributionChart';
import { GapsMap } from '@/components/GapsMap';
import { catchmentRadius } from '@/lib/modules/territoryMath';
import { daypartCurve } from '@/lib/modules/p2p3Math';
import { isPrimaryModule } from '@/lib/modules/verticalConfig';
import type { Vertical, ModuleKind } from '@prisma/client';

/** Persisted payload shapes we read (loosely typed — from module_result.payload JSON). */
export interface SiteModulePayloads {
  territory: {
    maxOverlapPct?: number; meanOverlapPct?: number; totalCannibalizedPhp?: number;
    ownOutletOverlapPct?: number; competitiveSaturationPct?: number; competitorCount?: number;
    competitorMix?: { direct: number; adjacent: number; unrelated: number };
    weightedCompetitorCount?: number; conceptLabel?: string;
    headlineSource?: 'own' | 'competitive' | 'none';
    competitorSet?: { anchorBrand: string; competitors: string[]; truthLayer: string; subjectBrand?: string | null } | null;
    verdict?: 'adds' | 'mixed' | 'redistributes'; candidateCatchmentM?: number;
    affectedOutlets?: Array<{ outletName: string; overlapPct: number; distanceM: number }>;
    realCompetitors?: Array<{ name: string; lat: number; lon: number }>;
    mapCompetitors?: Array<{ name: string; lat: number; lon: number; tier?: 'direct' | 'adjacent' | 'unrelated'; category?: string }>;
    /** Per-field Truth Layer written by the module (e.g. overlapPct: 'assumed'). */
    truth?: { overlapPct?: string; competitiveSaturation?: string; cannibalizedPhp?: string };
  } | null;
  lease: {
    corridor?: string; sampleSize?: number; baseRentPercentile?: number | null;
    negotiatingRoomPhpSqm?: number | null; negotiatingRoomPct?: number | null;
    medianPhpSqm?: number | null; p25PhpSqm?: number | null; p75PhpSqm?: number | null;
    verdict?: 'below_market' | 'at_market' | 'above_market' | 'insufficient_data' | 'corridor_benchmark';
    comps?: Array<{ baseRentPhpSqm: number | null }>;
    truth?: { comps?: string; fairRange?: string; zonalBand?: string };
    flags?: string[];
    format?: string;
  } | null;
  daypart: {
    daytimeShare?: number; windowMatchPct?: number; hourly?: number[]; peakHour?: number;
    verdict?: string; corridor?: string | null; noCatchmentData?: boolean;
    seasonality?: {
      peakSeason?: { season: string; label: string; low: number; high: number } | null;
      troughSeason?: { season: string; label: string; low: number; high: number } | null;
      termTimeNote?: string | null;
      swings?: Array<{ season: string; low: number; high: number; label: string }>;
    } | null;
  } | null;
  whitespace: {
    /** New shape: top recommended expansion areas (cannibalization ≤ threshold). */
    recommendations?: Array<{
      rank: number;
      barangay: string | null;
      city: string | null;
      population: number;
      lat: number | null;
      lon: number | null;
      cannibalizationPct: number;
      competitorMix: { direct: number; adjacent: number; unrelated: number };
      weightedCompetitorCount: number;
      nearestOwnM: number | null;
      nearbyBusinesses: string[];
      recommendationScore: number;
      verdict: 'open' | 'workable' | 'contested';
      reason: string;
    }>;
    scanned?: number;
    threshold?: number;
    catchmentM?: number;
    concept?: { key: string; label: string } | null;
    competitorSet?: { anchorBrand: string; competitors: string[]; truthLayer: string; subjectBrand?: string | null } | null;
    /** Legacy shape (runs made before the recommendations rebuild) — triggers a re-run prompt. */
    gaps?: Array<{ barangay: string | null; opportunityScore: number; reason?: string; lat?: number | null; lon?: number | null }>;
  } | null;
  /** AI Analysis Report — the retrieve-then-generate capstone, persisted per site. */
  analysis: {
    /** 'ready' | 'generating' (a generation holds the per-site lock). Legacy rows omit it. */
    status?: string;
    startedAt?: string;
    analysis?: string;
    schemaText?: string;
    model?: string;
    confidence?: 'high' | 'med' | 'low';
    generatedAt?: string;
    check?: AiCheck | null;
    contextJson?: {
      truthLayerSummary?: { verified: number; assumed: number; projected: number };
      meta?: { overallConfidence?: string; generatedAt?: string; siteLabel?: string } & Record<string, unknown>;
      [k: string]: unknown;
    } | null;
  } | null;
}

const TABS = [
  { key: 'territory', label: 'Territory Guard' },
  { key: 'lease', label: 'Lease Benchmark' },
  { key: 'daypart', label: 'Daypart Demand' },
  { key: 'whitespace', label: 'White-Space' },
  { key: 'analysis', label: 'Analysis' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function Chip({ tone, children }: { tone: 'go' | 'caution' | 'nogo' | 'muted'; children: React.ReactNode }) {
  const cls = tone === 'go' ? 'bg-go/10 text-go' : tone === 'nogo' ? 'bg-nogo/10 text-nogo' : tone === 'caution' ? 'bg-caution/10 text-caution' : 'bg-ink-panel-2 text-ink-muted';
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{children}</span>;
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="card-inset p-4">
      <p className="text-xs uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-ink-text">{value}</p>
      {sub && <p className="mt-1 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

/** Post-generation guardrail check stored with each AI analysis (lib/ai/outputCheck.ts). */
type AiCheck = { ungroundedNumbers: string[]; priceVerdictPhrases: string[]; ok: boolean };

type TL = 'Verified' | 'Assumed' | 'Projected';
/** A payload's per-field truth string → display label (fallback when absent on legacy runs). */
function tl(v: string | null | undefined, fallback: TL): TL {
  return v === 'verified' ? 'Verified' : v === 'assumed' ? 'Assumed' : v === 'projected' ? 'Projected' : fallback;
}
/** Missing numbers display as "—", never as a fabricated 0. */
const fmtPct = (v: number | null | undefined): string => (v == null ? '—' : `${v}%`);
const fmtPeso = (v: number | null | undefined): string => (v == null ? '—' : `₱${Math.round(v).toLocaleString()}`);

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * Contextual-read banner. Shown when a module ran for a format it isn't the primary read
 * for (e.g. Daypart for a fuel station, White-Space for a single café). The numbers are
 * real, but they carry less decision weight here — say so honestly rather than letting a
 * weak-context result read as authoritative.
 */
function ContextualNote({ module }: { module: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border-l-4 border-projected bg-projected/10 px-4 py-2.5">
      <span className="text-projected" aria-hidden>ⓘ</span>
      <p className="text-xs leading-relaxed text-ink-muted">
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
        <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/15 text-accent" aria-hidden>↻</span>
        <div>
          <p className="text-sm font-semibold text-ink-text">{module} will populate on the next run</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
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
  runId,
}: {
  site: { id: string; label: string; lat: number; lon: number; siteType: string | null };
  outlets: Array<{ id: string; name: string; lat: number; lon: number; format: string | null }>;
  payloads: SiteModulePayloads;
  vertical?: Vertical | null;
  runId?: string;
}) {
  const [tab, setTab] = useState<TabKey>('territory');

  const mapOutlets: MapOutlet[] = outlets.map((o) => ({ id: o.id, name: o.name, lat: o.lat, lon: o.lon, catchmentM: catchmentRadius(o.format) }));

  // Is each module a primary (decision-grade) read for this format? Drives the "contextual"
  // badge. When vertical is unknown, treat everything as primary (no badge).
  const primary = (m: ModuleKind) => (vertical ? isPrimaryModule(vertical, m) : true);

  return (
    <div className="space-y-5">
      {/* Tab bar */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const has = payloads[t.key] != null;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                tab === t.key ? 'bg-accent text-ink-bg' : 'bg-ink-panel-2 text-ink-muted hover:bg-ink-hover'
              }`}
            >
              {t.label}{!has && <span className="ml-1 opacity-60">·</span>}
            </button>
          );
        })}
      </div>

      {tab === 'territory' && <TerritoryTab site={site} outlets={mapOutlets} p={payloads.territory} primary={primary('territory')} />}
      {tab === 'lease' && <LeaseTab p={payloads.lease} primary={primary('lease')} siteId={site.id} />}
      {tab === 'daypart' && <DaypartTab p={payloads.daypart} primary={primary('daypart')} />}
      {tab === 'whitespace' && <WhiteSpaceTab p={payloads.whitespace} primary={primary('whitespace')} />}
      {tab === 'analysis' && <AnalysisTab payloads={payloads} primary={primary} siteLabel={site.label} runId={runId} siteId={site.id} />}
    </div>
  );
}

/* ---- Territory ---------------------------------------------------------- */
const T_VERDICT = {
  adds: { label: 'Adds sales', tone: 'go' as const },
  mixed: { label: 'Mixed — some redistribution', tone: 'caution' as const },
  redistributes: { label: 'Redistributes existing sales', tone: 'nogo' as const },
};

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
  const verdict = p.verdict ?? 'mixed';
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
          <p className="text-xs text-ink-muted">
            {comps} nearby establishments from the database
            {mix ? ` · ${mix.direct} direct competitor${mix.direct === 1 ? '' : 's'} and ${mix.adjacent} adjacent format${mix.adjacent === 1 ? '' : 's'} inside the catchment` : same > 0 ? ` · ${same} same-concept` : ''}
            {p.conceptLabel ? `, matched against ${p.conceptLabel}` : ''}.
            {mix ? ' Grey dots are other businesses — shown for context only, not counted as competitors.' : ''}
          </p>
        )}
      </div>
      <div className="space-y-3">
        <div className="card p-5">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Verdict</p>
          <p className="mt-1 text-xl font-bold"><Chip tone={T_VERDICT[verdict].tone}>{T_VERDICT[verdict].label}</Chip></p>
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
                ? `with your nearest branch (${tl(p.truth?.overlapPct, 'Assumed')})`
                : `no own branch in this catchment (${tl(p.truth?.overlapPct, 'Assumed')})`
          }
        />

        {/* Competitive saturation — the cannibalization-map signal. Projected. This is the
            read that stops a new brand in a saturated corridor from showing a false 0%. */}
        <Stat
          label="Competitive saturation"
          value={fmtPct(p.competitiveSaturationPct)}
          sub={
            !tiered
              ? 'competitor tiers not computed on this run — re-run the pipeline (Projected)'
              : mix
                ? `${mix.direct} direct + ${mix.adjacent} adjacent in the catchment · weighted ${p.weightedCompetitorCount ?? mix.direct} (Projected)`
                : `${p.competitorCount ?? 0} direct competitors in the catchment (Projected)`
          }
        />

        <Stat label="Est. monthly cannibalization" value={fmtPeso(p.totalCannibalizedPhp)} sub="own-branch model (Projected)" />

        {/* Who you compete with — named from the Cannibalization Map. */}
        {p.competitorSet && p.competitorSet.competitors.length > 0 && (
          <div className="card p-5">
            <p className="mb-1 text-sm font-medium text-ink-text">Competes with</p>
            <p className="mb-2 text-[11px] text-ink-muted">
              {p.competitorSet.subjectBrand
                ? `Competitor set for ${p.competitorSet.subjectBrand} — ${p.competitorSet.anchorBrand}-class rivals (${p.competitorSet.truthLayer})`
                : `Reference competitor set — ${p.competitorSet.anchorBrand}-class (${p.competitorSet.truthLayer})`}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {p.competitorSet.competitors.slice(0, 10).map((c, i) => (
                <span key={`${c}-${i}`} className="rounded-full bg-ink-panel-2 px-2 py-0.5 text-[11px] text-ink-muted">{c}</span>
              ))}
            </div>
          </div>
        )}

        <div className="card p-5">
          <p className="mb-2 text-sm font-medium text-ink-text">Affected outlets</p>
          {(p.affectedOutlets?.length ?? 0) === 0 ? (
            <p className="text-sm text-ink-muted">No existing branch overlaps this catchment.</p>
          ) : (
            <ul className="space-y-1 text-sm text-ink-muted">
              {dedupeOutlets(p.affectedOutlets!).map((a, i) => (
                <li key={`${a.outletName}-${i}`} className="flex justify-between"><span>{a.outletName}</span><span>{a.overlapPct}% · {Math.round(a.distanceM)} m</span></li>
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
// Positional labels only — no price verdicts (Grid guardrail). Shared wording in lib/truth/guardrailCopy.
const L_VERDICT = {
  below_market: { label: LEASE_POSITION_LABEL.below_market, tone: 'go' as const },
  at_market: { label: LEASE_POSITION_LABEL.at_market, tone: 'caution' as const },
  above_market: { label: LEASE_POSITION_LABEL.above_market, tone: 'caution' as const },
  insufficient_data: { label: LEASE_POSITION_LABEL.insufficient_data, tone: 'muted' as const },
  corridor_benchmark: { label: LEASE_POSITION_LABEL.corridor_benchmark, tone: 'caution' as const },
};
function LeaseTab({ p, primary = true, siteId }: { p: SiteModulePayloads['lease']; primary?: boolean; siteId: string }) {
  const router = useRouter();
  const [askingRent, setAskingRent] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

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
      setSaveMsg('Saved — the site score now includes this rent. Regenerate the Analysis tab to include it in the write-up.');
      router.refresh();
    } catch { setSaveState('error'); setSaveMsg('The request failed — check your connection and try again.'); }
  }
  if (!p) return <RerunNote module="Lease Benchmark" />;
  const v = p.verdict ?? 'insufficient_data';
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
        <p className="text-xs uppercase tracking-wide text-ink-muted">Verdict</p>
        <p className="mt-1 text-xl font-bold"><Chip tone={L_VERDICT[v].tone}>{L_VERDICT[v].label}</Chip></p>
        <p className="mt-2 text-sm text-ink-muted">
          {v === 'insufficient_data'
            ? `Only ${n} comparable lease${n === 1 ? '' : 's'} in ${p.corridor ?? 'this corridor'} — treat any range as indicative.`
            : v === 'corridor_benchmark'
              ? `This ran automatically with your analysis: the ${p.corridor ?? 'corridor'} benchmark from ${n} comparable lease${n === 1 ? '' : 's'}. Enter your asking rent below to see instantly where it sits in the corridor spread (below / within / above the median range).`
              : `Asking rate sits ${p.baseRentPercentile != null ? `at the ${ordinal(p.baseRentPercentile)} percentile` : 'within the range'} of the ${p.corridor ?? 'corridor'} spread across ${n} comps.`}
        </p>

        {/* Inline asking-rent check — the input the call-to-action promised. */}
        {compRents.length > 0 && (
          <div className="mt-4 border-t border-ink-border pt-3">
            <label className="text-xs font-medium text-ink-muted">Your asking rent (₱/sqm/mo)</label>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                inputMode="decimal"
                value={askingRent}
                onChange={(e) => setAskingRent(e.target.value)}
                placeholder={median != null ? `corridor median ≈ ${Math.round(median).toLocaleString()}` : 'e.g. 1450'}
                className="field w-48 px-2 py-1.5 text-sm"
              />
              {enteredPct != null && (
                <span className="text-sm text-ink-text">
                  → <span className="font-semibold">{ordinal(enteredPct)} percentile</span>{' '}
                  <span className={enteredPct >= 60 ? 'text-caution' : 'text-go'}>
                    ({enteredPct >= 60 ? 'above' : enteredPct <= 40 ? 'below' : 'around'} corridor median)
                  </span>
                </span>
              )}
            </div>
            {enteredPct != null && (
              <p className="mt-1 text-[11px] text-ink-muted">
                {enteredPct >= 60
                  ? 'Room to negotiate down toward the median.'
                  : enteredPct <= 40
                    ? 'Below the corridor median.'
                    : 'Right around the corridor median.'}
              </p>
            )}
            {enteredPct != null && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={useInScore}
                  disabled={saveState === 'saving'}
                  className="rounded-lg border border-ink-border px-3 py-1.5 text-xs font-medium text-ink-text hover:border-accent disabled:opacity-50"
                  title="Store this asking rent so the Lease criterion counts in the site score"
                >
                  {saveState === 'saving' ? 'Saving…' : 'Use this rent in the site score'}
                </button>
                {saveMsg && <span className={`text-[11px] ${saveState === 'error' ? 'text-nogo' : 'text-ink-muted'}`}>{saveMsg}</span>}
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
            : `${n} comparable leases (${tl(p.truth?.comps, 'Assumed')})`
        }
      />
      <Stat label="Base-rent percentile" value={p.baseRentPercentile != null ? ordinal(p.baseRentPercentile) : '—'} sub="within corridor (Assumed)" />
      {p.negotiatingRoomPhpSqm != null && (
        <Stat
          label="Negotiating room to median"
          value={`₱${Math.abs(p.negotiatingRoomPhpSqm).toLocaleString()}/sqm`}
          sub={p.negotiatingRoomPct != null ? `${Math.abs(p.negotiatingRoomPct)}% ${p.negotiatingRoomPhpSqm > 0 ? 'above' : 'below'} median` : undefined}
        />
      )}
    </div>

    {/* Distribution chart — the corridor spread, shown automatically with the run.
        Reuses the same chart the standalone Lease Benchmark page uses. */}
    {compRents.length > 0 && (
      <div className="card p-5">
        <p className="mb-3 text-sm font-medium text-ink-text">Base rent vs corridor comps</p>
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

    {/* Comparable-leases table. */}
    {compRents.length > 0 && (
      <div className="card p-5">
        <p className="mb-3 text-sm font-medium text-ink-text">Comparable leases in {p.corridor ?? 'this corridor'} ({compRents.length})</p>
        <div className="overflow-hidden rounded-lg border border-ink-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-ink-panel-2 text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Base rent (₱/sqm/mo)</th>
                <th className="px-3 py-2 font-medium">vs median</th>
              </tr>
            </thead>
            <tbody>
              {compRents.map((r, i) => {
                const delta = median != null ? r - median : null;
                return (
                  <tr key={i} className="border-t border-ink-border">
                    <td className="px-3 py-2 text-ink-muted">{i + 1}</td>
                    <td className="px-3 py-2 font-medium text-ink-text">₱{r.toLocaleString()}</td>
                    <td className="px-3 py-2">
                      {delta == null ? (
                        <span className="text-ink-muted">—</span>
                      ) : (
                        <span className={delta > 0 ? 'text-caution' : delta < 0 ? 'text-go' : 'text-ink-muted'}>
                          {delta > 0 ? '+' : ''}{delta.toLocaleString()} ({delta > 0 ? 'above' : delta < 0 ? 'below' : 'at'})
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
          <p className="mb-2 text-sm font-medium text-ink-text">Demand across the day</p>
          <p className="text-sm text-ink-muted">The daytime-vs-residential split for this catchment isn&apos;t derived — the demographic (daytime-population) layer isn&apos;t loaded for this location. Rather than show a false 0% curve, the app withholds the daypart mix here. Load a demographic layer to compute it. Seasonality (right) is modelled from corridor data and still applies.</p>
        </div>
      ) : (
        <div className="card p-5 lg:col-span-2">
          <p className="mb-3 text-sm font-medium text-ink-text">Demand across the day · {officeLed ? 'office-led (midday peak)' : 'residential (evening peak)'}</p>
          <DaypartCurve data={data} />
        </div>
      )}
      <div className="space-y-3">
        {noData ? (
          <Stat label="Catchment mix" value="Not derived" sub="demographic layer not loaded (Projected)" />
        ) : (
          <>
        <Stat label="Peak-hour demand captured" value={fmtPct(p.windowMatchPct)} sub="falls inside the format's target window (Projected)" />
        <Stat label="Catchment mix" value={`${daytimePct}% daytime`} sub={`${residentialPct}% residential · peaks ${officeLed ? '11:00–14:00' : '17:00–20:00'}`} />
          </>
        )}

        {/* SEASONALITY — the "& Seasonality" half. Corridor demand swing across the NCR
            calendar (Christmas peak, Undas/Holy Week exodus dip) + vertical term-time note. */}
        {p.seasonality && (p.seasonality.peakSeason || p.seasonality.termTimeNote) && (
          <div className="card p-5">
            <p className="mb-1 text-xs uppercase tracking-wide text-ink-muted">Seasonality (Projected)</p>
            {p.seasonality.peakSeason && (
              <p className="text-sm text-ink-text">
                Peaks in <span className="font-semibold">{p.seasonality.peakSeason.label}</span>
                <span className="text-go"> (×{p.seasonality.peakSeason.low}–{p.seasonality.peakSeason.high})</span>
              </p>
            )}
            {p.seasonality.troughSeason && (
              <p className="text-sm text-ink-text">
                Softest in <span className="font-semibold">{p.seasonality.troughSeason.label}</span>
                <span className="text-nogo"> (×{p.seasonality.troughSeason.low}–{p.seasonality.troughSeason.high})</span>
              </p>
            )}
            {p.seasonality.termTimeNote && (
              <p className="mt-1 text-[11px] text-ink-muted">{p.seasonality.termTimeNote}</p>
            )}
            {p.corridor && <p className="mt-1 text-[11px] text-ink-muted">Corridor: {p.corridor}</p>}
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
              White-Space scanned {scanned.toLocaleString()} barangay{scanned === 1 ? '' : 's'} for {conceptLabel} and
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
        <p className="text-xs uppercase tracking-wide text-ink-muted">Recommended locations</p>
        <p className="mt-1 text-lg font-bold text-ink-text">
          Top {recs.length} area{recs.length === 1 ? '' : 's'} to open{brand ? ` a ${brand} branch` : ''}
        </p>
        <p className="mt-1 text-sm text-ink-muted">
          Areas with a cannibalization score of {threshold} or less for {conceptLabel} — low same-concept overlap and
          real demand. Scored the same way as Territory Guard, across {scanned.toLocaleString()} barangay
          {scanned === 1 ? '' : 's'}. Cannibalization is Projected.
        </p>
      </div>

      {/* Overview map: every recommended area pinned by its rank. */}
      <div className="card p-5">
        <p className="mb-3 text-sm font-medium text-ink-text">Recommended areas · OpenStreetMap</p>
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
          <p className="mb-1 text-sm font-medium text-ink-text">Competes with</p>
          <p className="mb-2 text-[11px] text-ink-muted">
            {brand
              ? `Competitor set for ${brand} — ${p.competitorSet.anchorBrand}-class rivals (${p.competitorSet.truthLayer})`
              : `Reference competitor set — ${p.competitorSet.anchorBrand}-class (${p.competitorSet.truthLayer})`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {p.competitorSet.competitors.slice(0, 12).map((c, i) => (
              <span key={`${c}-${i}`} className="rounded-full bg-ink-panel-2 px-2 py-0.5 text-[11px] text-ink-muted">{c}</span>
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
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-ink-bg">{r.rank}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-ink-text">{r.barangay ?? 'Unnamed area'}</p>
                  {r.city && <p className="truncate text-xs text-ink-muted">{r.city}</p>}
                </div>
                <Chip tone={v.tone}>{v.label}</Chip>
              </div>

              {/* Data row — same fields Territory Guard shows, per area. */}
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Cannibalization" value={`${Math.round(r.cannibalizationPct)}%`} sub="lower is better (Projected)" />
                <Stat
                  label="Same-concept nearby"
                  value={`${r.competitorMix.direct} direct`}
                  sub={`+ ${r.competitorMix.adjacent} adjacent in catchment`}
                />
                <Stat label="Population" value={r.population.toLocaleString()} sub="catchment residents (Verified)" />
                <Stat
                  label="Nearest own branch"
                  value={r.nearestOwnM == null ? 'None nearby' : `${Math.round(r.nearestOwnM).toLocaleString()} m`}
                  sub={r.nearestOwnM == null ? 'no self-cannibalization' : 'from your closest outlet'}
                />
              </div>

              {/* The actual businesses in the area — the "exact or similar businesses" to weigh. */}
              <div className="mt-4">
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-muted">Businesses in the area</p>
                {r.nearbyBusinesses.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {r.nearbyBusinesses.map((b, i) => (
                      <span key={`${b}-${i}`} className="rounded-full bg-ink-panel-2 px-2 py-0.5 text-[11px] text-ink-text">{b}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-ink-muted">Open ground — no same-concept or adjacent businesses found in the catchment.</p>
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
function ReportRow({ label, value, truth }: { label: string; value: React.ReactNode; truth?: 'Verified' | 'Assumed' | 'Projected' }) {
  const truthCls = truth === 'Verified' ? 'text-verified' : truth === 'Assumed' ? 'text-assumed' : 'text-projected';
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-border/40 py-1.5 last:border-0">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink-text">
        {value}
        {truth && <span className={`ml-2 text-[10px] uppercase tracking-wide ${truthCls}`}>({truth})</span>}
      </span>
    </div>
  );
}

/** A per-module section of the combined report: title, verdict chip, and its key figures. */
function ReportSection({
  title, tab, ran, verdict, verdictTone, contextual, children,
}: {
  title: string; tab: string; ran: boolean;
  verdict?: string; verdictTone?: 'go' | 'caution' | 'nogo' | 'muted';
  contextual?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink-text">{title}</p>
          <p className="text-[11px] uppercase tracking-wide text-ink-muted">{tab} tab</p>
        </div>
        {ran && verdict ? <Chip tone={verdictTone ?? 'muted'}>{verdict}</Chip> : !ran ? <Chip tone="muted">Not run</Chip> : null}
      </div>
      {contextual && ran && (
        <p className="mt-1 text-[11px] text-projected">Contextual read for this format — carries lower weight in the decision.</p>
      )}
      {ran ? (
        <div className="mt-3">{children}</div>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">This module has no stored result for this site — re-run the analysis to populate it.</p>
      )}
    </div>
  );
}

/** Lease payload may also carry a BIR zonal block (not in the base UI type) — read it loosely. */
type LeaseZonal = {
  band?: { classification?: string | null; lowPhpSqm?: number | null; highPhpSqm?: number | null; midPhpSqm?: number | null } | null;
  crossCheck?: { position?: string | null } | null;
  usedAsFallback?: boolean;
} | null;

function AnalysisTab({
  payloads, primary, siteLabel, runId, siteId,
}: {
  payloads: SiteModulePayloads;
  primary: (m: ModuleKind) => boolean;
  siteLabel: string;
  runId?: string;
  siteId: string;
}) {
  const cached = payloads.analysis;
  type Report = { analysis: string; schemaText?: string; model?: string; confidence?: string; generatedAt?: string; check?: AiCheck | null };
  const [report, setReport] = useState<Report | null>(
    cached && typeof cached.analysis === 'string' && cached.status !== 'generating'
      ? { analysis: cached.analysis, schemaText: cached.schemaText, model: cached.model, confidence: cached.confidence, generatedAt: cached.generatedAt, check: cached.check ?? null }
      : null,
  );
  const [loading, setLoading] = useState(false);
  // True while ANOTHER request (e.g. the intake submit) is writing this site's analysis.
  const [waiting, setWaiting] = useState<boolean>(cached?.status === 'generating');
  const [error, setError] = useState<string | null>(null);
  const [showSchema, setShowSchema] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const pollTries = useRef(0);

  function applyReport(r: Report) {
    setReport({ analysis: r.analysis, schemaText: r.schemaText, model: r.model, confidence: r.confidence, generatedAt: r.generatedAt, check: r.check ?? null });
    setShowSchema(false);
  }

  // Poll the READ-ONLY status endpoint while a generation is in flight elsewhere (never bills).
  // Each tick schedules one check; `pollTick` re-arms the effect for the next one.
  useEffect(() => {
    if (!waiting || !runId) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      pollTries.current += 1;
      try {
        const res = await fetch(`/api/analysis-report?runId=${encodeURIComponent(runId)}&siteId=${encodeURIComponent(siteId)}`);
        const json = await res.json().catch(() => null);
        if (cancelled) return;
        const st = json?.data?.status;
        if (st === 'ready') { applyReport(json.data.report); setWaiting(false); return; }
        if (st === 'missing') { setWaiting(false); return; } // the other attempt failed → Generate shows
      } catch { /* network blip — keep polling */ }
      if (cancelled) return;
      if (pollTries.current >= 30) {
        setWaiting(false);
        setError('The analysis is taking longer than expected. Refresh the page in a minute.');
        return;
      }
      setPollTick((n) => n + 1);
    }, 4000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [waiting, runId, siteId, pollTick]);

  async function run(regen: boolean) {
    if (!runId) { setError('Open this site from the Ranked Site Shortlist to generate its report.'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/analysis-report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, siteId, force: regen }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        // Show the short reason code (e.g. timeout, http_401, db_migration_pending) so the cause is
        // visible without server logs. Netlify's own timeout page is not JSON → "function_timeout".
        const reason = json?.error?.details?.find((d: { path: string }) => d.path === 'reason')?.message
          ?? (json == null && (res.status === 502 || res.status === 504) ? 'function_timeout' : null);
        setError(`${json?.error?.message ?? `Could not generate the report (HTTP ${res.status}).`}${reason ? ` [reason: ${reason}]` : ''}`);
        return;
      }
      if (json.data?.status === 'generating') { pollTries.current = 0; setWaiting(true); setPollTick((n) => n + 1); return; }
      if (json.data?.status === 'ready') applyReport(json.data.report);
    } catch { setError('The request failed — check your connection and try again.'); }
    finally { setLoading(false); }
  }

  function exportPdf() {
    if (!runId) return;
    window.open(`/api/analysis-report/pdf?runId=${encodeURIComponent(runId)}&siteId=${encodeURIComponent(siteId)}`, '_blank');
  }

  const paras = report ? report.analysis.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean) : [];

  const t = payloads.territory;
  const l = payloads.lease;
  const d = payloads.daypart;
  const w = payloads.whitespace;

  const ranCount = [t, l, d, w].filter(Boolean).length;

  // Territory read (carried from the Territory Guard tab).
  const tVerdict = t?.verdict ?? 'mixed';
  const tMix = t?.competitorMix;
  const tOwn = t?.ownOutletOverlapPct ?? t?.maxOverlapPct ?? null;

  // Lease read (carried from the Lease Benchmark tab).
  const lV = (l?.verdict ?? 'insufficient_data') as keyof typeof L_VERDICT;
  const lZonal = (l as (SiteModulePayloads['lease'] & { zonal?: LeaseZonal }) | null)?.zonal ?? null;

  // Daypart read (carried from the Daypart Demand tab). Verdict band from the already-computed
  // window-match figure — a display threshold, not a new calculation.
  const dNoData = d?.noCatchmentData === true;
  const dWindow = d?.windowMatchPct ?? null;
  const dTone: 'go' | 'caution' | 'nogo' | 'muted' = dWindow == null ? 'muted' : dWindow >= 60 ? 'go' : dWindow >= 40 ? 'caution' : 'nogo';
  const dLabel = dWindow == null ? 'Not derived' : dWindow >= 60 ? 'Strong window match' : dWindow >= 40 ? 'Partial window match' : 'Weak window match';
  const dShare = d?.daytimeShare ?? 50;
  const dOfficeLed = dShare >= 50;

  // White-Space read (carried from the White-Space tab).
  const wRecs = w?.recommendations ?? null;
  const wTop = wRecs ? wRecs.slice(0, 3) : [];
  const wProposed = (w as (SiteModulePayloads['whitespace'] & { proposed?: { cannibalizationPct?: number } }) | null)?.proposed;

  return (
    <div className="space-y-4">
      {/* Header + AI narrative (the FINAL REPORT card) */}
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-ink-muted">Final report</p>
            <p className="mt-1 text-lg font-bold text-ink-text">Combined site intelligence — {siteLabel}</p>
            <p className="mt-1 max-w-2xl text-sm text-ink-muted">
              Every module for this site in one view — Territory Guard, Lease Benchmark, Daypart Demand and White-Space.
              Each figure is carried straight from its tab with its Truth Layer intact; nothing here is recomputed.
              {' '}<span className="text-ink-text">{ranCount} of 4 modules</span> have a stored result for this site.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {/* Generate shows ONLY until a report exists; once generated it's hidden
                (reports are pre-generated at intake submission and cached). */}
            {report == null && (
              <button
                onClick={() => run(false)}
                disabled={loading || waiting}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${loading ? 'bg-ink-panel-2 text-ink-muted' : 'bg-accent text-ink-bg hover:opacity-90'}`}
              >
                {loading || waiting ? 'Analysing…' : 'Generate analysis'}
              </button>
            )}
            {/* Export the branded professional PDF (server-generated) once a report exists. */}
            {report != null && (
              <button
                onClick={() => run(true)}
                disabled={loading || waiting}
                title="Write a fresh version of this analysis (limited to a few per site per day)"
                className="rounded-lg border border-ink-border px-4 py-2 text-sm font-medium text-ink-muted transition hover:text-ink-text disabled:opacity-50"
              >
                {loading || waiting ? 'Regenerating…' : 'Regenerate'}
              </button>
            )}
            {report != null && (
              <button
                onClick={exportPdf}
                disabled={loading || waiting}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-ink-bg transition hover:opacity-90 disabled:opacity-50"
              >
                Export site PDF
              </button>
            )}
          </div>
        </div>

        {/* The written analysis */}
        <div className="mt-4 border-t border-ink-border pt-4">
          {error && <div className="mb-3 rounded-lg border-l-4 border-nogo bg-nogo/10 px-4 py-2.5 text-sm text-ink-text">{error}</div>}

          {report ? (
            <>
              <div className="space-y-3 text-[15px] leading-relaxed text-ink-text">
                {paras.length ? paras.map((para, i) => <p key={i}>{para}</p>) : <p>{report.analysis}</p>}
              </div>
              {report.check && !report.check.ok && (
                <div className="mt-3 rounded-lg border-l-4 border-caution bg-caution/10 px-4 py-2.5 text-sm text-ink-text">
                  <p className="font-medium">Check before sharing</p>
                  {report.check.ungroundedNumbers.length > 0 && (
                    <p className="mt-1 text-ink-muted">
                      These figures could not be matched to the site data: <span className="text-ink-text">{report.check.ungroundedNumbers.join(', ')}</span>.
                      Verify them against the sections below, or regenerate.
                    </p>
                  )}
                  {report.check.priceVerdictPhrases.length > 0 && (
                    <p className="mt-1 text-ink-muted">
                      Contains price-verdict wording (<span className="text-ink-text">{report.check.priceVerdictPhrases.join(', ')}</span>) — BSA positions rents
                      against the corridor; the price judgement is the broker&apos;s. Edit before sharing, or regenerate.
                    </p>
                  )}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
                {report.confidence && <Chip tone={report.confidence === 'high' ? 'go' : report.confidence === 'low' ? 'muted' : 'caution'}>Confidence: {report.confidence}</Chip>}
                <span>{report.model === 'mock-analysis-v1' ? 'Mock analysis (preview)' : report.model}</span>
                {/* Fixed Manila-time formatter: identical on the server and in the browser (toLocaleString
                    differed — UTC on Netlify vs the viewer's zone — and broke hydration, React #418). */}
                {report.generatedAt && <span>· {manilaShortStamp(new Date(report.generatedAt))}</span>}
              </div>
              {report.schemaText && (
                <div className="mt-3">
                  <button onClick={() => setShowSchema((v) => !v)} className="text-xs font-medium text-accent hover:underline">
                    {showSchema ? '▾ Hide the data schema the AI read' : '▸ Show the data schema the AI read'}
                  </button>
                  {showSchema && (
                    <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-ink-panel-2 p-4 text-[11px] leading-relaxed text-ink-muted">{report.schemaText}</pre>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              {loading || waiting
                ? 'Reading the four modules and writing the analysis…'
                : 'Click Generate analysis to turn the combined data below into a short written report. It reads only the figures on this page — nothing is invented.'}
            </p>
          )}
        </div>
      </div>

      {/* Territory Guard */}
      <ReportSection
        title="Territory Guard"
        tab="Territory Guard"
        ran={t != null}
        verdict={T_VERDICT[tVerdict].label}
        verdictTone={T_VERDICT[tVerdict].tone}
        contextual={!primary('territory')}
      >
        {t && (
          <div>
            {t.headlineSource === 'competitive' && (
              <p className="mb-2 text-xs text-ink-muted">Driven by competitive saturation, not your own branches.</p>
            )}
            <ReportRow label="Own-branch overlap" value={fmtPct(tOwn)} truth={tl(t.truth?.overlapPct, 'Assumed')} />
            <ReportRow
              label="Competitive saturation"
              value={tMix ? `${fmtPct(t.competitiveSaturationPct)} · ${tMix.direct} direct + ${tMix.adjacent} adjacent` : fmtPct(t.competitiveSaturationPct)}
              truth={tl(t.truth?.competitiveSaturation, 'Projected')}
            />
            <ReportRow label="Est. monthly cannibalization" value={fmtPeso(t.totalCannibalizedPhp)} truth={tl(t.truth?.cannibalizedPhp, 'Projected')} />
            {t.competitorSet?.competitors?.length ? (
              <ReportRow label="Competes with" value={t.competitorSet.competitors.slice(0, 5).join(', ')} />
            ) : null}
            <ReportRow
              label="Affected own outlets"
              value={(t.affectedOutlets?.length ?? 0) === 0 ? 'None in this catchment' : `${t.affectedOutlets!.length}`}
              truth={tl(t.truth?.overlapPct, 'Assumed')}
            />
          </div>
        )}
      </ReportSection>

      {/* Lease Benchmark */}
      <ReportSection
        title="Lease Benchmark"
        tab="Lease Benchmark"
        ran={l != null}
        verdict={L_VERDICT[lV].label}
        verdictTone={L_VERDICT[lV].tone}
        contextual={!primary('lease')}
      >
        {l && (
          <div>
            <ReportRow label="Corridor" value={l.corridor ?? '—'} />
            <ReportRow label="Comparable leases" value={`${l.sampleSize ?? l.comps?.length ?? 0}`} truth={tl(l.truth?.comps, 'Assumed')} />
            <ReportRow
              label="Base-rent percentile"
              value={l.baseRentPercentile != null ? ordinal(l.baseRentPercentile) : '—'}
              truth="Assumed"
            />
            {l.negotiatingRoomPhpSqm != null && (
              <ReportRow
                label="Negotiating room to median"
                value={`₱${Math.abs(l.negotiatingRoomPhpSqm).toLocaleString()}/sqm${l.negotiatingRoomPct != null ? ` (${Math.abs(l.negotiatingRoomPct)}% ${l.negotiatingRoomPhpSqm > 0 ? 'above' : 'below'})` : ''}`}
                truth="Assumed"
              />
            )}
            {lZonal?.band && (
              <ReportRow
                label="BIR zonal band (tax-reference floor)"
                value={
                  `${lZonal.band.classification ?? 'CR'} · ${fmtPeso(lZonal.band.lowPhpSqm)}–${fmtPeso(lZonal.band.highPhpSqm)}/sqm` +
                  (lZonal.crossCheck?.position ? ` · ${lZonal.crossCheck.position.replace(/_/g, ' ')}` : '') +
                  (lZonal.usedAsFallback ? ' · used as fallback anchor' : '')
                }
                truth="Verified"
              />
            )}
          </div>
        )}
      </ReportSection>

      {/* Daypart Demand */}
      <ReportSection
        title="Daypart Demand"
        tab="Daypart Demand"
        ran={d != null}
        verdict={dNoData ? 'Catchment mix not derived' : dLabel}
        verdictTone={dNoData ? 'muted' : dTone}
        contextual={!primary('daypart')}
      >
        {d && (
          <div>
            <ReportRow label="Peak-hour demand captured" value={fmtPct(dWindow)} truth="Projected" />
            <ReportRow
              label="Catchment mix"
              value={dNoData ? 'Not derived (demographic layer not loaded)' : `${Math.round(dShare * 10) / 10}% daytime · ${Math.round((100 - dShare) * 10) / 10}% residential`}
              truth="Projected"
            />
            {!dNoData && (
              <ReportRow label="Peak window" value={dOfficeLed ? '11:00–14:00 (office-led)' : '17:00–20:00 (residential)'} truth="Projected" />
            )}
            {d.seasonality?.peakSeason?.label && (
              <ReportRow label="Seasonal peak" value={d.seasonality.peakSeason.label} truth="Projected" />
            )}
            {d.seasonality?.troughSeason?.label && (
              <ReportRow label="Seasonal trough" value={d.seasonality.troughSeason.label} truth="Projected" />
            )}
          </div>
        )}
      </ReportSection>

      {/* White-Space */}
      <ReportSection
        title="White-Space"
        tab="White-Space"
        ran={w != null && wRecs != null}
        verdict={wRecs ? (wTop.length ? `${wRecs.length} recommended area${wRecs.length === 1 ? '' : 's'}` : 'No open areas in coverage') : undefined}
        verdictTone={wRecs && wTop.length ? 'go' : 'muted'}
        contextual={!primary('whitespace')}
      >
        {w && wRecs && (
          <div>
            <ReportRow label="Barangays scanned" value={(w.scanned ?? 0).toLocaleString()} truth="Verified" />
            <ReportRow label="Cannibalization threshold" value={`≤ ${w.threshold ?? 40}`} truth="Projected" />
            {wProposed?.cannibalizationPct != null && (
              <ReportRow label="This site's cannibalization" value={`${Math.round(wProposed.cannibalizationPct)}%`} truth="Projected" />
            )}
            {wTop.length > 0 ? (
              wTop.map((r, i) => (
                <ReportRow
                  key={`${r.barangay}-${i}`}
                  label={`#${r.rank ?? i + 1} ${r.barangay ?? 'Unnamed area'}${r.city ? `, ${r.city}` : ''}`}
                  value={`${Math.round(r.cannibalizationPct)}% cannibalization`}
                  truth="Projected"
                />
              ))
            ) : (
              <p className="mt-2 text-sm text-ink-muted">No area in current coverage scored at or below the threshold — the network is saturated for this concept here.</p>
            )}
          </div>
        )}
        {w && wRecs == null && (
          <p className="mt-2 text-sm text-ink-muted">This run predates the recommendations rebuild — re-run the analysis to compute White-Space areas.</p>
        )}
      </ReportSection>

      <p className="px-1 text-[11px] text-ink-muted">
        The sections below are a straight consolidation of the four tabs; the written analysis above phrases only these figures.
        {' '}{ZONAL_FLOOR_NOTE}
      </p>
    </div>
  );
}

function NoData({ module, note }: { module: string; note?: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-sm text-ink-muted">{note ?? `${module} did not run for this site's vertical.`}</p>
    </div>
  );
}
