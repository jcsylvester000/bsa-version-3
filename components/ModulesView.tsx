'use client';

import { useMemo, useState } from 'react';
import { TruthChip } from '@/components/TruthChip';
import type { TruthLayer } from '@/lib/truth/truthLayer';

export interface ModuleRow {
  id: string;
  module: string;
  moduleLabel: string;
  site: string;
  score: number | null;
  truthLayer: string;
  flags: string[];
  payload: Record<string, unknown>;
}

/**
 * All-Modules results view — dark-themed, readable, filterable, and INTERPRETED.
 *
 * The stored `score` is raw and module-specific (Territory = overlap %, where LOW is good;
 * Site Fit = fitness, where HIGH is good). Showing the raw number with a naive high=green
 * rule misleads a broker — a "0 overlap" (no cannibalization = the best outcome) reads as a
 * red failure. This view mirrors the Site Report's interpretation: it reads each score in the
 * right direction, colours a GOODNESS value, and shows a plain-language meaning per module,
 * so the same data reads consistently everywhere. Real pipeline data only; no mock.
 */

// Per-module interpretation, matching lib/modules/reportComposer.ts metricsForModule().
interface Interp {
  metricLabel: string;       // what the number measures, in plain terms
  display: string;           // the value as shown (may add % or units)
  goodness: number | null;   // 0–100 where higher is always better (for colour)
  meaning: string;           // one-line broker-facing meaning
}
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const r1 = (n: number) => Math.round(n * 10) / 10;

function interpret(r: ModuleRow): Interp {
  const p = r.payload ?? {};
  const s = r.score;
  switch (r.module) {
    case 'site_fit': {
      const v = String(p.verdict ?? '');
      return { metricLabel: 'Site-fit composite', display: s != null ? String(r1(s)) : '—', goodness: s,
        meaning: v === 'go' ? 'Strong site fit' : v === 'nogo' ? 'Weak site fit' : v ? 'Moderate site fit' : 'Catchment & competition fit' };
    }
    case 'territory': {
      // Headline = max(own-branch overlap %, competitive saturation %). LOWER is better.
      // The headline now reflects competitor cannibalization too, so a NEW brand in a
      // saturated corridor no longer reads as a false "0% — adds sales".
      const overlap = num(p.maxOverlapPct) ?? (s ?? 0);
      const own = num(p.ownOutletOverlapPct) ?? 0;
      const sat = num(p.competitiveSaturationPct) ?? 0;
      const cnt = num(p.competitorCount) ?? 0;
      const mx = p.competitorMix as { direct: number; adjacent: number } | undefined;
      const cannib = num(p.totalCannibalizedPhp) ?? 0;
      const goodness = 100 - overlap; // invert: 0% → 100 goodness
      const bySaturation = p.headlineSource === 'competitive' || (sat > own);
      let meaning: string;
      if (overlap <= 0) {
        meaning = 'No overlap and no competitors nearby — adds sales';
      } else if (bySaturation) {
        // Saturation is tier-weighted, so name the mix rather than a bare count.
        const who = mx ? `${mx.direct} direct + ${mx.adjacent} adjacent` : `${cnt} same-concept`;
        meaning = `${who} competitors nearby → ${r1(sat)}% competitive saturation`;
      } else {
        meaning = overlap < 30
          ? `${r1(overlap)}% own-branch overlap — mostly incremental`
          : `${r1(overlap)}% own-branch overlap${cannib > 0 ? ` · ~₱${cannib.toLocaleString()}/mo cannibalized` : ''}`;
      }
      const metricLabel = bySaturation ? 'Cannibalization (competitive)' : 'Trade-area overlap';
      return { metricLabel, display: `${r1(overlap)}%`, goodness, meaning };
    }
    case 'lease': {
      const st = p.baseRentStats as { median?: number; n?: number } | undefined;
      if (p.verdict === 'corridor_benchmark' && st?.median != null) {
        return { metricLabel: 'Corridor rent benchmark', display: `₱${Math.round(st.median).toLocaleString()}/sqm`, goodness: null,
          meaning: `Corridor median (n=${st.n ?? 0}) — enter your asking rent to benchmark` };
      }
      const pct = num(p.baseRentPercentile);
      return { metricLabel: 'Rent vs corridor', display: pct != null ? `${pct}th pct` : '—',
        goodness: pct != null ? 100 - pct : null, // lower percentile = cheaper = better
        meaning: pct != null ? `${pct}th percentile of corridor rents` : 'Corridor benchmark' };
    }
    case 'daypart': {
      const day = num(p.daytimeShare);
      return { metricLabel: 'Peak-window demand', display: s != null ? String(r1(s)) : '—', goodness: s,
        meaning: day != null ? `${r1(day)}% daytime catchment` : 'Demand timing across the day' };
    }
    case 'informal': {
      const total = num(p.totalEstimated) ?? 0;
      // score = competition-intensity (higher = LESS competition = better). But it floors at 5.
      return { metricLabel: 'Competition intensity', display: s != null ? String(r1(s)) : '—', goodness: s,
        meaning: `${total} est. competitors nearby${p.onGroundCheckAdvised ? ' · on-ground check advised' : ''}` };
    }
    case 'whitespace':
      return { metricLabel: 'Top white-space gap', display: s != null ? String(r1(s)) : '—', goodness: s,
        meaning: s != null ? 'Best unserved gap in the network' : 'Network gap ranking' };
    case 'mall':
      return { metricLabel: 'Mall fit', display: s != null ? String(r1(s)) : '—', goodness: s,
        meaning: String(p.mallName ? `Nearest: ${p.mallName}` : 'Mall tier & footfall') };
    case 'healthcare': {
      const note = p.catchmentNote ? String(p.catchmentNote) : null;
      const meaning = note ? `Referral proximity + catchment: ${note}` : 'Proximity to referral sources';
      return { metricLabel: 'Healthcare fit', display: s != null ? String(r1(s)) : '—', goodness: s, meaning };
    }
    case 'land': {
      const band = String(p.trafficBand ?? 'unknown').replace('_', ' ');
      const corr = p.corridor ? String(p.corridor) : null;
      const range = Array.isArray(p.seasonRange) ? (p.seasonRange as Array<{ season: string; low: number; high: number }>) : [];
      const xmas = range.find((x) => x.season === 'christmas');
      const undas = range.find((x) => x.season === 'undas');
      const rng = (x: { low: number; high: number }) => `${Math.round(x.low)}–${Math.round(x.high)}`;
      // Show the corridor traffic band + a season swing hint when available. The range is a
      // 0–100 seasonal demand index (rounded for the headline), so a busy corridor still
      // shows a real Christmas peak vs Holy-Week/Undas swing rather than a flat "100–100".
      const meaning = corr
        ? `${corr} corridor · ${band} traffic${xmas ? ` · Christmas ${rng(xmas)}` : ''}${undas ? ` · Undas ${rng(undas)}` : ''}`
        : String(p.verdict ?? 'Frontage, lot & zoning screen');
      return { metricLabel: 'Land & traffic screen', display: s != null ? String(r1(s)) : '—', goodness: s, meaning };
    }
    default:
      return { metricLabel: 'Score', display: s != null ? String(r1(s)) : '—', goodness: s, meaning: '' };
  }
}

export function ModulesView({ rows }: { rows: ModuleRow[] }) {
  const sites = useMemo(() => Array.from(new Set(rows.map((r) => r.site))).sort(), [rows]);
  const modules = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.module)) seen.set(r.module, r.moduleLabel);
    return Array.from(seen.entries());
  }, [rows]);

  const [site, setSite] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');

  const filtered = rows.filter((r) => (!site || r.site === site) && (!moduleFilter || r.module === moduleFilter));

  const grouped = useMemo(() => {
    const g = new Map<string, { label: string; items: ModuleRow[] }>();
    for (const r of filtered) {
      const entry = g.get(r.module) ?? { label: r.moduleLabel, items: [] };
      entry.items.push(r);
      g.set(r.module, entry);
    }
    return Array.from(g.entries());
  }, [filtered]);

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="card flex flex-wrap items-end gap-4 p-4">
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Candidate site</span>
          <select value={site} onChange={(e) => setSite(e.target.value)} className="field mt-1 w-64">
            <option value="">All sites ({sites.length})</option>
            {sites.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Module</span>
          <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="field mt-1 w-56">
            <option value="">All modules ({modules.length})</option>
            {modules.map(([m, label]) => <option key={m} value={m}>{label}</option>)}
          </select>
        </label>
        {(site || moduleFilter) && (
          <button onClick={() => { setSite(''); setModuleFilter(''); }} className="btn-ghost text-sm">Clear filters</button>
        )}
        <span className="ml-auto pb-2 text-xs text-ink-muted">{filtered.length} result{filtered.length === 1 ? '' : 's'}</span>
      </div>

      <p className="text-xs text-ink-muted">
        Each score is read in its own direction — for Territory, low overlap is good (no cannibalization); the colour
        reflects the real-world reading, matching the Site Report.
      </p>

      {grouped.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-muted">No module results match these filters.</div>
      ) : (
        grouped.map(([module, { label, items }]) => (
          <section key={module} className="card p-5">
            <h2 className="mb-3 text-lg font-semibold text-ink-text">{label}</h2>
            <div className="overflow-hidden rounded-lg border border-ink-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-ink-panel-2 text-left text-xs uppercase tracking-wide text-ink-muted">
                    <th className="px-3 py-2 font-medium">Site</th>
                    <th className="px-3 py-2 font-medium">Reading</th>
                    <th className="px-3 py-2 font-medium">What it means</th>
                    <th className="px-3 py-2 font-medium">Truth Layer</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => {
                    const it = interpret(r);
                    return (
                      <tr key={r.id} className="border-t border-ink-border align-top">
                        <td className="px-3 py-2 text-ink-text">{r.site}</td>
                        <td className="px-3 py-2">
                          <span className={`font-bold ${goodnessCls(it.goodness)}`}>{it.display}</span>
                          <span className="ml-1 block text-[11px] text-ink-muted">{it.metricLabel}</span>
                        </td>
                        <td className="px-3 py-2 text-ink-muted">{it.meaning}</td>
                        <td className="px-3 py-2"><TruthChip layer={r.truthLayer as TruthLayer} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}

/** Colour a GOODNESS value (0–100, higher always better). Null → neutral. */
function goodnessCls(g: number | null): string {
  if (g == null) return 'text-ink-text';
  return g >= 65 ? 'text-go' : g >= 45 ? 'text-caution' : 'text-nogo';
}
