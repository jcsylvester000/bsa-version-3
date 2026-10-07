/**
 * Site Intelligence Dashboard data — the command center after a pipeline run.
 * Pure assembly from the run's module_results into: KPI tiles, ranked shortlist,
 * Truth Layer quality mix, and Intelligence Alerts (module findings tagged to source).
 */
import { gateComposite, territoryGate } from './scorecard';
import type { TruthLayer } from '@/lib/truth/truthLayer';

export interface DashSite {
  siteId: string;
  label: string;
  city: string | null;
  composite: number | null;
  verdict: 'go' | 'caution' | 'nogo' | null;
  /** Short highlights, e.g. "office-led · rent within benchmark · no territory conflict". */
  highlights: string[];
}

export interface DashAlert {
  module: string;      // e.g. "territory"
  moduleLabel: string; // e.g. "Territory Guard"
  /** 'info' = a statement, not a status (e.g. rent position — no price verdicts). */
  severity: 'go' | 'caution' | 'nogo' | 'info';
  title: string;
  detail: string;
  truthLayer: TruthLayer;
}

export interface DashboardData {
  sitesCleared: { go: number; total: number; flagged: number };
  topSiteFit: { score: number | null; site: string | null; note?: string };
  territoryConflicts: number;
  leaseOutliers: number;
  ranked: DashSite[];
  truthMix: { verified: number; assumed: number; projected: number; pct: { verified: number; assumed: number; projected: number } };
  confidence: 'high' | 'med' | 'low' | null;
  alerts: DashAlert[];
}

export interface ModuleResultLite {
  module: string;
  score: number | null;
  truthLayer: TruthLayer;
  flags: string[];
  payload: Record<string, unknown>;
  site: { id: string; label: string; city: string | null; composite: number | null; verdict: string | null; pipelineError?: string | null };
}

const MODULE_LABEL: Record<string, string> = {
  site_fit: 'Site Fit', territory: 'Territory Guard', lease: 'Lease Benchmark',
  daypart: 'Daypart Demand', informal: 'Informal Competitor', mall: 'Mall Intelligence',
  healthcare: 'Healthcare Proximity', whitespace: 'White-Space', land: 'Land & Traffic',
};

export function buildDashboard(
  rows: ModuleResultLite[],
  /** The run's stored evidence confidence (set by the pipeline). Preferred over the local
   *  fallback so the dashboard, write-up and PDF show the same label. */
  opts: { runConfidence?: DashboardData['confidence'] } = {},
): DashboardData {
  rows = rows.filter((r) => r.module !== 'analysis'); // the AI write-up is not a module finding
  // Group by site.
  const sites = new Map<string, ModuleResultLite['site'] & { modules: ModuleResultLite[] }>();
  for (const r of rows) {
    const s = sites.get(r.site.id) ?? { ...r.site, modules: [] };
    s.modules.push(r);
    sites.set(r.site.id, s);
  }

  const ranked: DashSite[] = [];
  let territoryConflicts = 0;
  let leaseOutliers = 0;
  let topSiteFit: { score: number | null; site: string | null; note?: string } = { score: null, site: null };
  let siteFitDemandMissing = false;
  const alerts: DashAlert[] = [];
  const allLayers: TruthLayer[] = [];

  for (const s of sites.values()) {
    const byModule = new Map(s.modules.map((m) => [m.module, m]));
    const highlights: string[] = [];

    const fit = byModule.get('site_fit');
    if (fit?.score != null && (topSiteFit.score == null || fit.score > topSiteFit.score)) {
      topSiteFit = { score: fit.score, site: s.label };
    }
    if (fit && (fit.flags ?? []).includes('site_fit_demand_layer_missing')) siteFitDemandMissing = true;

    const terr = byModule.get('territory');
    if (terr) {
      const overlap = Number((terr.payload as { maxOverlapPct?: number }).maxOverlapPct ?? 0);
      const v = String((terr.payload as { verdict?: string }).verdict ?? '');
      if (v === 'redistributes') {
        territoryConflicts++;
        highlights.push('territory conflict');
        // Peso cannibalization needs branch sales on file to project. When it's 0, that
        // almost always means we have no sales data — say so, rather than "₱0" which
        // reads as "no impact" and contradicts the high overlap.
        const cannib = Number((terr.payload as { totalCannibalizedPhp?: number }).totalCannibalizedPhp ?? 0);
        const cannibText = cannib > 0
          ? `Projected monthly cannibalization ₱${cannib.toLocaleString()}.`
          : `Peso impact not estimated — no branch sales on file for this network.`;
        alerts.push({
          module: 'territory', moduleLabel: 'Territory Guard', severity: 'nogo',
          title: `Territory conflict — ${s.label}`,
          detail: `Trade-area overlaps an existing branch at ${overlap}%. ${cannibText}`,
          truthLayer: 'projected',
        });
      } else {
        // Any non-conflict territory outcome still reports a status, so the
        // shortlist subtitle is consistent instead of falling back to the city name.
        highlights.push('no territory conflict');
      }
    }

    const lease = byModule.get('lease');
    if (lease) {
      const v = String((lease.payload as { verdict?: string }).verdict ?? '');
      const pct = (lease.payload as { baseRentPercentile?: number }).baseRentPercentile;
      if (v === 'above_market') {
        leaseOutliers++;
        highlights.push('rent above corridor median');
        // Broker decision (Skill 07, 2026-09-28): rent position is a statement for the broker to
        // explain, not a caution flag — 'info', positional wording, no "room to negotiate".
        alerts.push({
          module: 'lease', moduleLabel: 'Lease Benchmark', severity: 'info',
          title: `Rent above the corridor median — ${s.label}`,
          detail: `Asking rent sits at the ${pct ?? '?'}th percentile of comparable leases in the corridor.`,
          truthLayer: 'assumed',
        });
      } else if (v === 'below_market') {
        highlights.push('rent below corridor median');
      }
    }

    const daypart = byModule.get('daypart');
    if (daypart) {
      const wm = (daypart.payload as { windowMatchPct?: number }).windowMatchPct;
      if (typeof wm === 'number' && wm >= 60) {
        highlights.push('daypart match');
        alerts.push({
          module: 'daypart', moduleLabel: 'Daypart Demand', severity: 'go',
          title: `Daypart match — ${s.label}`,
          detail: `${Math.round(wm)}% of demand falls inside the format's target window.`,
          truthLayer: 'projected',
        });
      }
    }

    for (const m of s.modules) allLayers.push(m.truthLayer);

    // Territory deal-breaker at read time (runs stored before the gate): the dashboard must agree
    // with the Final Report — a site that redistributes its own sales never shows Go.
    const terrOverlap = terr ? Number((terr.payload as { maxOverlapPct?: number }).maxOverlapPct ?? terr.score ?? NaN) : null;
    const gate = territoryGate(Number.isFinite(terrOverlap as number) ? terrOverlap : null);
    const rawComposite = s.composite != null ? Number(s.composite) : (fit?.score ?? null);
    let gatedVerdict = (s.verdict as 'go' | 'caution' | 'nogo' | null) ?? null;
    if (gatedVerdict && gate.maxBand === 'nogo') gatedVerdict = 'nogo';
    else if (gatedVerdict === 'go' && gate.maxBand === 'caution') gatedVerdict = 'caution';
    ranked.push({
      siteId: s.id, label: s.label, city: s.city,
      composite: gateComposite(rawComposite, gate.cap != null ? terrOverlap : null),
      verdict: gatedVerdict,
      highlights: highlights.slice(0, 3),
    });
  }

  if (topSiteFit.score == null && siteFitDemandMissing) topSiteFit.note = 'Demographic layer not loaded';

  ranked.sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));

  const goCount = ranked.filter((r) => r.verdict === 'go').length;
  const flagged = ranked.filter((r) => r.verdict === 'caution' || r.verdict === 'nogo').length;

  const mix = { verified: 0, assumed: 0, projected: 0 };
  for (const l of allLayers) mix[l]++;
  const total = allLayers.length || 1;
  const pct = {
    verified: Math.round((mix.verified / total) * 100),
    assumed: Math.round((mix.assumed / total) * 100),
    projected: Math.round((mix.projected / total) * 100),
  };
  // Legacy fallback only (runs finalized before Batch 3 have no evidence confidence).
  const confidence: DashboardData['confidence'] = opts.runConfidence !== undefined && opts.runConfidence !== null
    ? opts.runConfidence
    : pct.projected >= 34 ? 'low' : pct.verified >= 60 && pct.projected < 20 ? 'high' : 'med';

  // Sites where a module failed on the last pass — never silent.
  for (const s of sites.values()) {
    if (s.pipelineError) {
      alerts.push({
        module: 'pipeline',
        moduleLabel: 'Analysis',
        severity: 'caution',
        title: `Some modules did not complete for ${s.label}`,
        detail: `Affected: ${s.pipelineError.split(' | ').map((e) => e.split(':')[0]).join(', ')}. Use "Re-run analysis" to retry; results shown for this site may be partial.`,
        truthLayer: 'projected',
      });
    }
  }

  // Order alerts most-severe first.
  const sev = { nogo: 0, caution: 1, go: 2, info: 3 };
  alerts.sort((a, b) => sev[a.severity] - sev[b.severity]);

  return {
    sitesCleared: { go: goCount, total: ranked.length, flagged },
    topSiteFit,
    territoryConflicts,
    leaseOutliers,
    ranked,
    truthMix: { ...mix, pct },
    confidence,
    alerts,
  };
}

export { MODULE_LABEL };
