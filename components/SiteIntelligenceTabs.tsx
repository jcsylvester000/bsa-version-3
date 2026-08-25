'use client';

import { useState } from 'react';
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
  } | null;
  lease: {
    corridor?: string; sampleSize?: number; baseRentPercentile?: number | null;
    negotiatingRoomPhpSqm?: number | null; negotiatingRoomPct?: number | null;
    medianPhpSqm?: number | null; p25PhpSqm?: number | null; p75PhpSqm?: number | null;
    verdict?: 'below_market' | 'at_market' | 'above_market' | 'insufficient_data' | 'corridor_benchmark';
    comps?: Array<{ baseRentPhpSqm: number | null }>;
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
    /** New shape: top recommended alternative areas, best-first (always up to `limit`). */
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
      nearbyPoints?: Array<{ name: string; lat: number; lon: number; tier: 'direct' | 'adjacent' }>;
      recommendationScore: number;
      verdict: 'open' | 'workable' | 'contested';
      beatsProposed?: boolean | null;
      reason: string;
    }>;
    scanned?: number;
    threshold?: number;
    catchmentM?: number;
    concept?: { key: string; label: string } | null;
    competitorSet?: { anchorBrand: string; competitors: string[]; truthLayer: string; subjectBrand?: string | null } | null;
    /** The site the user proposed — recommendations are the best alternatives that beat it. */
    proposed?: {
      label: string;
      city: string | null;
      cannibalizationPct: number;
      competitorMix: { direct: number; adjacent: number; unrelated: number };
      nearbyBusinesses: string[];
    } | null;
    /** Where candidate areas came from — demographic barangays, or business-derived when that layer is empty. */
    source?: 'demographic_cell' | 'poi_fallback';
    /** Legacy shape (runs made before the recommendations rebuild) — triggers a re-run prompt. */
    gaps?: Array<{ barangay: string | null; opportunityScore: number; reason?: string; lat?: number | null; lon?: number | null }>;
  } | null;
}

const TABS = [
  { key: 'territory', label: 'Territory Guard' },
  { key: 'lease', label: 'Lease Benchmark' },
  { key: 'daypart', label: 'Daypart Demand' },
  { key: 'whitespace', label: 'White-Space' },
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
}: {
  site: { id: string; label: string; lat: number; lon: number; siteType: string | null };
  outlets: Array<{ id: string; name: string; lat: number; lon: number; format: string | null }>;
  payloads: SiteModulePayloads;
  vertical?: Vertical | null;
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
      {tab === 'lease' && <LeaseTab p={payloads.lease} primary={primary('lease')} />}
      {tab === 'daypart' && <DaypartTab p={payloads.daypart} primary={primary('daypart')} />}
      {tab === 'whitespace' && <WhiteSpaceTab p={payloads.whitespace} primary={primary('whitespace')} />}
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

        {/* Own-branch overlap — Verified from coordinates. 0% for a brand with no outlets. */}
        <Stat
          label="Own-branch overlap"
          value={`${p.ownOutletOverlapPct ?? p.maxOverlapPct ?? 0}%`}
          sub={(p.ownOutletOverlapPct ?? p.maxOverlapPct ?? 0) > 0 ? 'with your nearest branch (Verified)' : 'no own branch in this catchment (Verified)'}
        />

        {/* Competitive saturation — the cannibalization-map signal. Projected. This is the
            read that stops a new brand in a saturated corridor from showing a false 0%. */}
        <Stat
          label="Competitive saturation"
          value={`${p.competitiveSaturationPct ?? 0}%`}
          sub={
            !tiered
              ? 'competitor tiers not computed on this run — re-run the pipeline (Projected)'
              : mix
                ? `${mix.direct} direct + ${mix.adjacent} adjacent in the catchment · weighted ${p.weightedCompetitorCount ?? mix.direct} (Projected)`
                : `${p.competitorCount ?? 0} direct competitors in the catchment (Projected)`
          }
        />

        <Stat label="Est. monthly cannibalization" value={`₱${(p.totalCannibalizedPhp ?? 0).toLocaleString()}`} sub="own-branch model (Projected)" />

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
const L_VERDICT = {
  below_market: { label: 'Below market — favourable', tone: 'go' as const },
  at_market: { label: 'At market', tone: 'caution' as const },
  above_market: { label: 'Above market — likely overpaying', tone: 'nogo' as const },
  insufficient_data: { label: 'Insufficient comparable data', tone: 'muted' as const },
  corridor_benchmark: { label: 'Corridor market benchmark', tone: 'caution' as const },
};
function LeaseTab({ p, primary = true }: { p: SiteModulePayloads['lease']; primary?: boolean }) {
  const [askingRent, setAskingRent] = useState('');
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
              ? `This ran automatically with your analysis: the ${p.corridor ?? 'corridor'} benchmark from ${n} comparable lease${n === 1 ? '' : 's'}. Enter your asking rent below to see instantly where it lands in the spread (at / above / below market).`
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
                    ? 'Below the corridor median — a competitive rate.'
                    : 'Right around the corridor median.'}
              </p>
            )}
          </div>
        )}
      </div>
      <Stat label="Corridor" value={p.corridor ?? '—'} sub={`${n} comparable leases`} />
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
        <Stat label="Peak-hour demand captured" value={`${p.windowMatchPct ?? 0}%`} sub="falls inside the format's target window (Projected)" />
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
 * White-Space = reverse Territory Guard. The user proposes ONE site; this recommends the TOP 5
 * BETTER alternative areas they did NOT enter — scored the same way Territory Guard scores a site,
 * ranked best-first, each shown with its verdict, the real businesses there, and how much lower its
 * cannibalization is than the proposed site. The ≤40 rule is an honest badge, not a hard gate, so
 * the user always gets the best available alternatives.
 *
 * States: (1) no stored result / legacy `gaps` payload → prompt a re-run; (2) no candidate areas at
 * all (no demographic or business data) → honest "load data" note; (3) recommendations → map + cards.
 */
function WhiteSpaceTab({ p }: { p: SiteModulePayloads['whitespace']; primary?: boolean }) {
  if (!p) return <RerunNote module="White-Space" />;
  // A run made before this rebuild has the old `gaps` shape and no `recommendations` key.
  if (p.recommendations == null) return <RerunNote module="White-Space" />;

  const recs = p.recommendations;
  const conceptLabel = p.concept?.label ?? 'this concept';
  const brand = p.competitorSet?.subjectBrand?.trim();
  const scanned = p.scanned ?? 0;
  const proposed = p.proposed ?? null;
  const proposedPct = proposed ? Math.round(proposed.cannibalizationPct) : null;
  const fallback = p.source === 'poi_fallback';

  if (recs.length === 0) {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-caution/15 text-caution" aria-hidden>!</span>
          <div>
            <p className="text-sm font-semibold text-ink-text">No candidate areas to compare yet</p>
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              White-Space needs a set of areas to rank against your proposed site, and none are loaded for {conceptLabel}
              {' '}right now — neither a demographic (barangay) layer nor enough mapped businesses to derive areas from.
            </p>
            <p className="mt-3 text-xs text-ink-muted">
              Load the demographic layer (<code>npm run db:populate:ncr</code>) or ingest more area POIs, then re-run this
              analysis and the top alternative locations will appear here.
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

  // Actual businesses across ALL 5 areas, for the map dots: red = direct/exact, white = adjacent/similar.
  const businessPoints = recs.flatMap((r) =>
    (r.nearbyPoints ?? []).filter((b) => Number.isFinite(b.lat) && Number.isFinite(b.lon)),
  );
  const directCount = businessPoints.filter((b) => b.tier === 'direct').length;
  const adjacentCount = businessPoints.filter((b) => b.tier === 'adjacent').length;

  return (
    <div className="space-y-4">
      {/* Header — reframed against the site the user actually proposed. */}
      <div className="card p-5">
        <p className="text-xs uppercase tracking-wide text-ink-muted">Better alternative locations</p>
        <p className="mt-1 text-lg font-bold text-ink-text">
          Top {recs.length} area{recs.length === 1 ? '' : 's'} to open{brand ? ` ${brand}` : ''} instead of your proposed site
        </p>
        {proposed ? (
          <p className="mt-1 text-sm text-ink-muted">
            You proposed <span className="font-medium text-ink-text">{proposed.label}</span>
            {proposed.city ? `, ${proposed.city}` : ''} — cannibalization <span className="font-medium text-ink-text">{proposedPct}%</span>{' '}
            for {conceptLabel}. Below are the best areas we scanned that you did <em>not</em> enter, ranked by lower
            cannibalization and demand (same scoring as Territory Guard). Cannibalization is Projected.
          </p>
        ) : (
          <p className="mt-1 text-sm text-ink-muted">
            The best areas to open {conceptLabel}, ranked by low same-concept cannibalization and demand. Cannibalization
            is Projected.
          </p>
        )}
        <p className="mt-2 text-[11px] text-ink-muted">
          Scanned {scanned.toLocaleString()} area{scanned === 1 ? '' : 's'} · {conceptLabel}
          {' · '}the badge marks how contested each area is (open ≤15, workable &lt;{p.threshold ?? 40}, contested ≥{p.threshold ?? 40}).
        </p>
        {fallback && (
          <p className="mt-2 rounded-md border-l-2 border-projected bg-projected/10 px-3 py-1.5 text-[11px] text-ink-muted">
            Demographic (barangay) layer not loaded — areas were derived from mapped businesses, so population isn&apos;t
            weighted. Run <code>npm run db:populate:ncr</code> for population-aware, barangay-level results.
          </p>
        )}
      </div>

      {/* Overview map: every recommended area pinned by its rank, with the actual businesses
          plotted as red (exact/direct) and white (similar/adjacent) dots so the visual matches
          the per-area data. */}
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-ink-text">Recommended areas · OpenStreetMap</p>
          <div className="flex items-center gap-3 text-[11px] text-ink-muted">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#e5484d', border: '1.5px solid #0b1426' }} />
              Exact / same concept{directCount ? ` (${directCount})` : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#e6ebf5', border: '1.5px solid #0b1426' }} />
              Similar / adjacent{adjacentCount ? ` (${adjacentCount})` : ''}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-accent text-[9px] font-bold text-ink-bg">#</span>
              Recommended area
            </span>
          </div>
        </div>
        {mapPoints.length > 0 ? (
          <GapsMap gaps={mapPoints} businesses={businessPoints} />
        ) : (
          <div className="rounded-lg border border-dashed border-ink-border p-4 text-center text-xs text-ink-muted">
            Re-run this analysis to attach area coordinates — the recommended areas will then plot on a map here.
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
          // How much better than the proposed site (positive = lower cannibalization = better).
          const delta = proposedPct == null ? null : proposedPct - Math.round(r.cannibalizationPct);
          const hasPop = r.population > 0;
          return (
            <div key={`${r.barangay}-${r.rank}`} className="card p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-sm font-bold text-ink-bg">{r.rank}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-ink-text">{r.barangay ?? 'Unnamed area'}</p>
                  {r.city && <p className="truncate text-xs text-ink-muted">{r.city}</p>}
                </div>
                {delta != null && (
                  <Chip tone={delta > 0 ? 'go' : delta < 0 ? 'caution' : 'muted'}>
                    {delta > 0 ? `${delta}% lower than your site` : delta < 0 ? `${Math.abs(delta)}% higher than your site` : 'same as your site'}
                  </Chip>
                )}
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
                <Stat
                  label="Population"
                  value={hasPop ? r.population.toLocaleString() : '—'}
                  sub={hasPop ? 'catchment residents (Verified)' : 'demographic layer not loaded'}
                />
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

function NoData({ module, note }: { module: string; note?: string }) {
  return (
    <div className="card p-8 text-center">
      <p className="text-sm text-ink-muted">{note ?? `${module} did not run for this site's vertical.`}</p>
    </div>
  );
}
