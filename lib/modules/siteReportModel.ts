/**
 * Site Final Report — ONE data model for the screen and the PDF.
 *
 * The Final Report tab (components/SiteIntelligenceTabs.tsx → AnalysisTab) and the exported site PDF
 * (app/api/analysis-report/pdf → lib/pdf/AnalysisPdf.tsx) both render `buildSiteReportModel(...)`, so the
 * PDF always carries exactly the data the user sees on screen: the recommendation (call, composite,
 * rank, headline, confidence, coverage, analysed time, Truth Layer mix), "What drove this call"
 * (status, finding, headline figure + Truth Layer, module) and the four module summaries with every
 * row and its Truth Layer. Pure and client-safe (no server-only / Prisma runtime imports).
 *
 * Nothing is recomputed or invented: each value is carried from the persisted module_result payloads,
 * with its Truth Layer kept in place. The call comes from summariseSite() driven by the site's composite
 * band (audit F-07), so the screen, the dashboard and the PDF can never disagree.
 */
import { gateComposite, territoryGate } from './scorecard';
import type { ModuleKind } from '@prisma/client';
import { fmtInt, fmtPeso } from '@/lib/util/format';
import { manilaShortStampYear } from '@/lib/util/manilaTime';
import { summariseSite, type SiteSummary, type Tone } from '@/lib/modules/siteVerdict';
import { LEASE_POSITION_LABEL, ZONAL_FLOOR_NOTE } from '@/lib/truth/guardrailCopy';
import type { TruthLayer } from '@/lib/truth/truthLayer';

// ---------------------------------------------------------------------------------------------
// Payload shapes (loosely typed — from module_result.payload JSON)
// ---------------------------------------------------------------------------------------------

/** Post-generation guardrail check stored with legacy AI analyses (lib/ai/outputCheck.ts). */
export type AiCheck = { ungroundedNumbers: string[]; priceVerdictPhrases: string[]; ok: boolean };

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
    /** Comp-set recency (F-14): 'data as of' + whether the set is ageing. */
    freshness?: { dataAsOf?: string | null; monthsSinceNewest?: number | null; isStale?: boolean };
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
  /** Legacy AI Analysis row — only its truth-mix summary is still read (hero fallback). */
  analysis: {
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

/** Hero context (composite, rank, confidence, analysed time, truth mix) — see siteReportMeta(). */
export interface SiteReportMeta {
  composite?: number | null;
  rank?: number | null;
  total?: number | null;
  confidence?: 'high' | 'med' | 'low' | null;
  /** Pre-formatted Manila time. */
  analysedAt?: string | null;
  truthPct?: { verified: number; assumed: number; projected: number } | null;
  /** Set when the territory deal-breaker capped the composite (scorecard.territoryGate). */
  capNote?: string | null;
}

// ---------------------------------------------------------------------------------------------
// Shared display helpers (also used by the tabs)
// ---------------------------------------------------------------------------------------------

export type TL = 'Verified' | 'Assumed' | 'Projected';
/** A payload's per-field truth string → display label (fallback when absent on legacy runs). */
export function tl(v: string | null | undefined, fallback: TL): TL {
  return v === 'verified' ? 'Verified' : v === 'assumed' ? 'Assumed' : v === 'projected' ? 'Projected' : fallback;
}
/** Display label → Truth Layer key. */
export const tk = (t: TL): TruthLayer => t.toLowerCase() as TruthLayer;
/** Missing numbers display as "—", never as a fabricated 0. */
export const fmtPct = (v: number | null | undefined): string => (v == null ? '—' : `${v}%`);
export const fmtPesoOrDash = (v: number | null | undefined): string => (v == null ? '—' : fmtPeso(v));
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

export const T_VERDICT = {
  adds: { label: 'Adds sales', tone: 'go' as const },
  mixed: { label: 'Mixed — some redistribution', tone: 'caution' as const },
  redistributes: { label: 'Redistributes existing sales', tone: 'nogo' as const },
};
// Every tone is 'muted': lease position is a statement, not a status (design v2 + broker decision).
export const L_VERDICT = {
  below_market: { label: LEASE_POSITION_LABEL.below_market, tone: 'muted' as const },
  at_market: { label: LEASE_POSITION_LABEL.at_market, tone: 'muted' as const },
  above_market: { label: LEASE_POSITION_LABEL.above_market, tone: 'muted' as const },
  insufficient_data: { label: LEASE_POSITION_LABEL.insufficient_data, tone: 'muted' as const },
  corridor_benchmark: { label: LEASE_POSITION_LABEL.corridor_benchmark, tone: 'muted' as const },
};

/** Lease payload may also carry a BIR zonal block (not in the base type) — read it loosely. */
export type LeaseZonal = {
  band?: { classification?: string | null; lowPhpSqm?: number | null; highPhpSqm?: number | null; midPhpSqm?: number | null } | null;
  crossCheck?: { position?: string | null } | null;
  usedAsFallback?: boolean;
} | null;

// ---------------------------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------------------------

export type ModuleKey = 'territory' | 'lease' | 'daypart' | 'whitespace';

export interface ReportRowModel {
  label: string;
  value: string;
  truth?: TruthLayer;
}

export interface ModuleSummaryModel {
  key: ModuleKey;
  title: string;
  ran: boolean;
  /** Status shown beside the title (icon + word). `null` when the module didn't run. */
  status: { tone: Tone; label: string } | null;
  /** Contextual read for this format — lower decision weight. */
  contextual: boolean;
  /** A one-line lead under the title (e.g. "Driven by competitive saturation…"). */
  lead?: string;
  rows: ReportRowModel[];
  /** Body text when there are no rows (not run / legacy / nothing in coverage). */
  emptyText?: string;
}

export interface FindingFigure { value: string; truth: TruthLayer }

export interface SiteReportModel {
  summary: SiteSummary;
  /** Show the honest-gap hero instead of a call (no composite band AND < 2 core modules). */
  limited: boolean;
  /** e.g. "4 of 4 modules". */
  coverageText: string;
  meta: SiteReportMeta;
  truthPct: { verified: number; assumed: number; projected: number } | null;
  /** Headline figure per finding keyword. */
  figures: Record<string, FindingFigure | undefined>;
  /** Which module tab each finding traces to. */
  findingModule: Record<string, { key: ModuleKey; label: string }>;
  modules: ModuleSummaryModel[];
  /** Footnote under the module summaries (includes the BIR zonal floor wording). */
  footnote: string;
}

export const FINDING_MODULE: Record<string, { key: ModuleKey; label: string }> = {
  Cannibalization: { key: 'territory', label: 'Territory Guard' },
  'Lease position': { key: 'lease', label: 'Lease Benchmark' },
  'Demand window': { key: 'daypart', label: 'Daypart Demand' },
  'White-space': { key: 'whitespace', label: 'White-Space' },
};

export function buildSiteReportModel(args: {
  payloads: SiteModulePayloads;
  /** candidate_site.verdict — the composite band ('go' | 'caution' | 'nogo' | null). */
  verdict?: string | null;
  /** Is the module a primary (decision-grade) read for this vertical? Default: all primary. */
  isPrimary?: (m: ModuleKind) => boolean;
  meta?: SiteReportMeta;
}): SiteReportModel {
  const { payloads } = args;
  const primary = args.isPrimary ?? (() => true);
  const meta = args.meta ?? {};
  const band = args.verdict === 'go' || args.verdict === 'caution' || args.verdict === 'nogo' ? args.verdict : null;

  const t = payloads.territory;
  const l = payloads.lease;
  const d = payloads.daypart;
  const w = payloads.whitespace;
  const ranCount = [t, l, d, w].filter(Boolean).length;

  const tVerdict = (t?.verdict && t.verdict in T_VERDICT ? t.verdict : 'mixed') as keyof typeof T_VERDICT;
  const tMix = t?.competitorMix;
  const tOwn = t?.ownOutletOverlapPct ?? t?.maxOverlapPct ?? null;

  const lV = (l?.verdict && l.verdict in L_VERDICT ? l.verdict : 'insufficient_data') as keyof typeof L_VERDICT;
  const lZonal = (l as (NonNullable<SiteModulePayloads['lease']> & { zonal?: LeaseZonal }) | null)?.zonal ?? null;

  const dNoData = d?.noCatchmentData === true;
  const dWindow = d?.windowMatchPct ?? null;
  const dTone: Tone = dWindow == null ? 'muted' : dWindow >= 60 ? 'go' : dWindow >= 40 ? 'caution' : 'nogo';
  const dLabel = dWindow == null ? 'Not derived' : dWindow >= 60 ? 'Strong window match' : dWindow >= 40 ? 'Partial window match' : 'Weak window match';
  const dShare = d?.daytimeShare ?? 50;
  const dOfficeLed = dShare >= 50;

  const wRecs = w?.recommendations ?? null;
  const wTop = wRecs ? wRecs.slice(0, 3) : [];
  const wProposed = (w as (NonNullable<SiteModulePayloads['whitespace']> & { proposed?: { cannibalizationPct?: number } }) | null)?.proposed;

  const summary = summariseSite(
    {
      territory: t ? { verdict: t.verdict ?? null, totalCannibalizedPhp: t.totalCannibalizedPhp ?? null, competitiveSaturationPct: t.competitiveSaturationPct ?? null } : null,
      lease: l ? { verdict: l.verdict ?? null, corridor: l.corridor ?? null } : null,
      daypart: d ? { windowMatchPct: d.windowMatchPct ?? null, noCatchmentData: d.noCatchmentData ?? null } : null,
      whitespace: wRecs ? { recommendations: wRecs.map((r) => ({ verdict: r.verdict ?? null })) } : null,
    },
    (k) => primary(k as ModuleKind),
    band ?? 'insufficient',
  );

  const legacyMix = payloads.analysis?.contextJson?.truthLayerSummary;
  const truthPct = meta.truthPct ?? (legacyMix ? (() => {
    const n = legacyMix.verified + legacyMix.assumed + legacyMix.projected || 1;
    return { verified: Math.round((legacyMix.verified / n) * 100), assumed: Math.round((legacyMix.assumed / n) * 100), projected: Math.round((legacyMix.projected / n) * 100) };
  })() : null);

  const figures: SiteReportModel['figures'] = {
    Cannibalization: t?.totalCannibalizedPhp != null
      ? { value: `${fmtPeso(t.totalCannibalizedPhp)} / mo`, truth: tk(tl(t.truth?.cannibalizedPhp, 'Projected')) }
      : undefined,
    'Lease position': l?.baseRentPercentile != null
      ? { value: `${ordinal(l.baseRentPercentile)} percentile`, truth: 'assumed' }
      : l?.medianPhpSqm != null
        ? { value: `median ₱${fmtInt(l.medianPhpSqm)}/sqm`, truth: tk(tl(l.truth?.comps, 'Assumed')) }
        : undefined,
    'Demand window': d && !dNoData && d.windowMatchPct != null
      ? { value: `${Math.round(d.windowMatchPct)}% in window`, truth: 'projected' }
      : undefined,
    'White-space': wRecs && wRecs.length
      ? { value: `${wRecs.length} area${wRecs.length === 1 ? '' : 's'}`, truth: 'projected' }
      : undefined,
  };

  const NOT_RUN = 'This module has no stored result for this site — re-run the analysis to populate it.';

  // --- Territory Guard ---
  const territory: ModuleSummaryModel = {
    key: 'territory', title: 'Territory Guard', ran: t != null, contextual: !primary('territory'),
    status: t ? { tone: T_VERDICT[tVerdict].tone, label: T_VERDICT[tVerdict].label } : null,
    lead: t?.headlineSource === 'competitive' ? 'Driven by competitive saturation, not your own branches.' : undefined,
    rows: t ? [
      { label: 'Own-branch overlap', value: fmtPct(tOwn), truth: tk(tl(t.truth?.overlapPct, 'Assumed')) },
      {
        label: 'Competitive saturation',
        value: tMix ? `${fmtPct(t.competitiveSaturationPct)} · ${tMix.direct} direct + ${tMix.adjacent} adjacent` : fmtPct(t.competitiveSaturationPct),
        truth: tk(tl(t.truth?.competitiveSaturation, 'Projected')),
      },
      { label: 'Est. monthly cannibalization', value: fmtPesoOrDash(t.totalCannibalizedPhp), truth: tk(tl(t.truth?.cannibalizedPhp, 'Projected')) },
      ...(t.competitorSet?.competitors?.length ? [{ label: 'Competes with', value: t.competitorSet.competitors.slice(0, 5).join(', ') }] : []),
      {
        label: 'Affected own outlets',
        value: (t.affectedOutlets?.length ?? 0) === 0 ? 'None in this catchment' : `${t.affectedOutlets!.length}`,
        truth: tk(tl(t.truth?.overlapPct, 'Assumed')),
      },
    ] : [],
    emptyText: t ? undefined : NOT_RUN,
  };

  // --- Lease Benchmark ---
  const lease: ModuleSummaryModel = {
    key: 'lease', title: 'Lease Benchmark', ran: l != null, contextual: !primary('lease'),
    status: l ? { tone: L_VERDICT[lV].tone, label: L_VERDICT[lV].label } : null,
    rows: l ? [
      { label: 'Corridor', value: l.corridor ?? '—' },
      { label: 'Comparable leases', value: `${l.sampleSize ?? l.comps?.length ?? 0}`, truth: tk(tl(l.truth?.comps, 'Assumed')) },
      ...(l.freshness?.dataAsOf
        ? [{ label: 'Comps data as of', value: l.freshness.isStale ? `${l.freshness.dataAsOf} · ageing` : l.freshness.dataAsOf }]
        : []),
      { label: 'Base-rent percentile', value: l.baseRentPercentile != null ? ordinal(l.baseRentPercentile) : '—', truth: 'assumed' as TruthLayer },
      ...(l.negotiatingRoomPhpSqm != null
        ? [{
            label: 'Distance from corridor median',
            value: `₱${fmtInt(Math.abs(l.negotiatingRoomPhpSqm))}/sqm${l.negotiatingRoomPct != null ? ` (${Math.abs(l.negotiatingRoomPct)}% ${l.negotiatingRoomPhpSqm > 0 ? 'above' : 'below'})` : ''}`,
            truth: 'assumed' as TruthLayer,
          }]
        : []),
      ...(lZonal?.band
        ? [{
            label: 'BIR zonal band (tax-reference floor)',
            value:
              `${lZonal.band.classification ?? 'CR'} · ${fmtPesoOrDash(lZonal.band.lowPhpSqm)}–${fmtPesoOrDash(lZonal.band.highPhpSqm)}/sqm` +
              (lZonal.crossCheck?.position ? ` · ${lZonal.crossCheck.position.replace(/_/g, ' ')}` : '') +
              (lZonal.usedAsFallback ? ' · used as fallback anchor' : ''),
            truth: tk(tl(l.truth?.zonalBand, 'Verified')),
          }]
        : []),
    ] : [],
    emptyText: l ? undefined : NOT_RUN,
  };

  // --- Daypart Demand ---
  const daypart: ModuleSummaryModel = {
    key: 'daypart', title: 'Daypart Demand', ran: d != null, contextual: !primary('daypart'),
    status: d ? (dNoData ? { tone: 'muted', label: 'Catchment mix not derived' } : { tone: dTone, label: dLabel }) : null,
    rows: d ? [
      { label: 'Peak-hour demand captured', value: fmtPct(dWindow), truth: 'projected' as TruthLayer },
      {
        label: 'Catchment mix',
        value: dNoData ? 'Not derived (demographic layer not loaded)' : `${Math.round(dShare * 10) / 10}% daytime · ${Math.round((100 - dShare) * 10) / 10}% residential`,
        truth: 'projected' as TruthLayer,
      },
      ...(!dNoData ? [{ label: 'Peak window', value: dOfficeLed ? '11:00–14:00 (office-led)' : '17:00–20:00 (residential)', truth: 'projected' as TruthLayer }] : []),
      ...(d.seasonality?.peakSeason?.label ? [{ label: 'Seasonal peak', value: d.seasonality.peakSeason.label, truth: 'projected' as TruthLayer }] : []),
      ...(d.seasonality?.troughSeason?.label ? [{ label: 'Seasonal trough', value: d.seasonality.troughSeason.label, truth: 'projected' as TruthLayer }] : []),
    ] : [],
    emptyText: d ? undefined : NOT_RUN,
  };

  // --- White-Space ---
  const wsRan = w != null && wRecs != null;
  const whitespace: ModuleSummaryModel = {
    key: 'whitespace', title: 'White-Space', ran: wsRan, contextual: !primary('whitespace'),
    status: wRecs
      ? (wTop.length
          ? { tone: 'go', label: `${wRecs.length} recommended area${wRecs.length === 1 ? '' : 's'}` }
          : { tone: 'muted', label: 'No open areas in coverage' })
      : null,
    rows: w && wRecs ? [
      { label: 'Barangays scanned', value: fmtInt(w.scanned ?? 0), truth: 'verified' as TruthLayer },
      { label: 'Cannibalization threshold', value: `≤ ${w.threshold ?? 40}`, truth: 'projected' as TruthLayer },
      ...(wProposed?.cannibalizationPct != null
        ? [{ label: "This site's cannibalization", value: `${Math.round(wProposed.cannibalizationPct)}%`, truth: 'projected' as TruthLayer }]
        : []),
      ...wTop.map((r, i) => ({
        label: `#${r.rank ?? i + 1} ${r.barangay ?? 'Unnamed area'}${r.city ? `, ${r.city}` : ''}`,
        value: `${Math.round(r.cannibalizationPct)}% cannibalization`,
        truth: 'projected' as TruthLayer,
      })),
    ] : [],
    emptyText: !w
      ? NOT_RUN
      : wRecs == null
        ? 'This run predates the recommendations rebuild — re-run the analysis to compute White-Space areas.'
        : wTop.length === 0
          ? 'No area in current coverage scored at or below the threshold — the network is saturated for this concept here.'
          : undefined,
  };

  return {
    summary,
    limited: band == null && summary.coverage < 2,
    coverageText: `${ranCount} of 4 modules`,
    meta,
    truthPct,
    figures,
    findingModule: FINDING_MODULE,
    modules: [territory, lease, daypart, whitespace],
    footnote: `The module summaries are a straight consolidation of the four tabs; the recommendation above is rolled up from only these figures. ${ZONAL_FLOOR_NOTE}`,
  };
}

/**
 * Hero context from the site service data (shared by the site page and the PDF route). Rank uses the
 * dashboard's ordering (composite desc, unscored last); the truth mix is this site's module-level
 * Truth Layers — the same method the dashboard uses for the run (the 'analysis' row is excluded).
 */
export function siteReportMeta(data: {
  site: { id: string; compositeScore: { toString(): string } | null; analyzedAt: Date | null };
  run: { confidence: 'high' | 'med' | 'low' | null };
  rows: Array<{ module: string; truthLayer: string; score?: unknown }>;
  runSites: Array<{ id: string; compositeScore: { toString(): string } | null }>;
}): SiteReportMeta {
  const num = (v: { toString(): string } | null): number | null => (v == null ? null : Number(v.toString()));
  // Territory deal-breaker at read time too, so runs stored before the gate never show "65 · Proceed"
  // next to a Redistributes territory call.
  const terr = data.rows.find((r) => r.module === 'territory');
  const overlap = terr?.score != null && Number.isFinite(Number(terr.score)) ? Number(terr.score) : null;
  const stored = num(data.site.compositeScore);
  const composite = gateComposite(stored, overlap);
  const gate = territoryGate(overlap);
  const capNote = gate.reason && stored != null && composite != null && composite < stored
    ? `${gate.reason} Composite capped at ${Math.round(composite)} (the weighted average alone would be ${Math.round(stored)}).`
    : gate.reason && composite != null && gate.cap != null && composite <= gate.cap ? gate.reason : null;
  const ranked = data.runSites
    .map((s) => ({ id: s.id, composite: num(s.compositeScore) }))
    .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
  const rankIdx = ranked.findIndex((s) => s.id === data.site.id);
  const layers = data.rows.filter((r) => r.module !== 'analysis').map((r) => r.truthLayer as TruthLayer);
  const pct = (k: TruthLayer) => Math.round((layers.filter((l) => l === k).length / layers.length) * 100);
  return {
    composite,
    rank: composite != null && rankIdx >= 0 ? rankIdx + 1 : null,
    total: composite != null ? ranked.length : null,
    confidence: data.run.confidence ?? null,
    capNote,
    analysedAt: data.site.analyzedAt ? manilaShortStampYear(data.site.analyzedAt) : null,
    truthPct: layers.length ? { verified: pct('verified'), assumed: pct('assumed'), projected: pct('projected') } : null,
  };
}

/** Service rows → typed payloads (shared by the site page and the PDF route). */
export function payloadsFromRows(rows: Array<{ module: string; payload: unknown }>): SiteModulePayloads {
  const by: Record<string, unknown> = {};
  for (const r of rows) by[r.module] = r.payload;
  return {
    territory: (by.territory as SiteModulePayloads['territory']) ?? null,
    lease: (by.lease as SiteModulePayloads['lease']) ?? null,
    daypart: (by.daypart as SiteModulePayloads['daypart']) ?? null,
    whitespace: (by.whitespace as SiteModulePayloads['whitespace']) ?? null,
    analysis: (by.analysis as SiteModulePayloads['analysis']) ?? null,
  };
}
