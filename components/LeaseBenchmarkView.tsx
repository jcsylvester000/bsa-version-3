'use client';

import { useState } from 'react';
import { LeaseDistributionChart } from '@/components/LeaseDistributionChart';
import { TruthChip } from '@/components/TruthChip';
import { AnalysisOverlay } from '@/components/AnalysisSequence';
import { InfoHint } from '@/components/InfoHint';
import { resolveCorridorForSite } from '@/lib/modules/leaseMath';
import type { TruthLayer } from '@/lib/truth/truthLayer';

interface DistributionStats {
  n: number;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
}
interface TermAssessment {
  term: string;
  label: string;
  value: number | null;
  stats: DistributionStats | null;
  percentile: number | null;
  flag: 'over' | 'under' | 'at' | 'insufficient';
  higherIsWorse: boolean;
}
interface LeaseResult {
  site: { id: string; label: string };
  corridor: string;
  format: string;
  baseRentPercentile: number | null;
  baseRentStats: DistributionStats | null;
  terms: TermAssessment[];
  sampleSize: number;
  lowSample: boolean;
  negotiatingRoomPhpSqm: number | null;
  negotiatingRoomPct: number | null;
  verdict: 'below_market' | 'at_market' | 'above_market' | 'insufficient_data' | 'corridor_benchmark';
  flags: string[];
  comps: Array<{ baseRentPhpSqm: number | null }>;
  truth: { comps: TruthLayer; fairRange: TruthLayer };
  verdictText: string;
}

const VERDICT_META: Record<string, { label: string; cls: string }> = {
  below_market: { label: 'Below market — favourable', cls: 'text-go' },
  at_market: { label: 'At market', cls: 'text-accent' },
  above_market: { label: 'Above market — likely overpaying', cls: 'text-nogo' },
  insufficient_data: { label: 'Insufficient comparable data', cls: 'text-ink-muted' },
  corridor_benchmark: { label: 'Corridor market benchmark', cls: 'text-accent' },
};

/**
 * Deterministic one-line lease summary from the actual numbers (no AI text).
 * States where the asking rate sits vs the corridor and the room to the median.
 */
function leaseSummary(r: LeaseResult): string {
  if (r.verdict === 'insufficient_data') {
    return `Only ${r.sampleSize} comparable lease${r.sampleSize === 1 ? '' : 's'} in ${r.corridor} — too few for a confident read. Treat any range as indicative.`;
  }
  if (r.verdict === 'corridor_benchmark') {
    return `${r.corridor} corridor benchmark from ${r.sampleSize} comparable leases. Enter your asking base rent above to see where it sits versus this spread and the room to the median.`;
  }
  const pct = r.baseRentPercentile != null ? `${ordinal(r.baseRentPercentile)} percentile of the ${r.corridor} spread` : `within the ${r.corridor} spread`;
  const room = r.negotiatingRoomPhpSqm != null && r.negotiatingRoomPct != null
    ? ` ${r.negotiatingRoomPhpSqm > 0 ? `₱${Math.abs(r.negotiatingRoomPhpSqm).toLocaleString()}/sqm (${Math.abs(r.negotiatingRoomPct)}%) above the median — room to negotiate down` : r.negotiatingRoomPhpSqm < 0 ? `₱${Math.abs(r.negotiatingRoomPhpSqm).toLocaleString()}/sqm below the median — a favourable rate` : 'right at the median'}.`
    : '.';
  const head = r.verdict === 'above_market' ? 'Asking rate is above market' : r.verdict === 'below_market' ? 'Asking rate is below market' : 'Asking rate is at market';
  return `${head} — ${pct} across ${r.sampleSize} comps.${room}`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

const FLAG_META: Record<string, { label: string; cls: string }> = {
  over: { label: 'Over market', cls: 'bg-nogo/10 text-nogo' },
  under: { label: 'Under market', cls: 'bg-go/10 text-go' },
  at: { label: 'At market', cls: 'bg-ink-panel-2 text-ink-muted' },
  insufficient: { label: 'Too few comps', cls: 'bg-ink-panel-2 text-ink-muted' },
};

interface SiteOption {
  id: string;
  label: string;
  siteType: string | null;
  city: string | null;
}

export function LeaseBenchmarkView({
  sites,
  corridors,
  defaultCorridor,
}: {
  sites: SiteOption[];
  corridors: string[];
  defaultCorridor: string;
}) {
  const [siteId, setSiteId] = useState(sites[0]?.id ?? '');
  // Preselect the corridor that matches the first site's location (a BGC site → BGC
  // comps), falling back to the server default when the site's city doesn't map to a
  // corridor we hold comps for. Keeps this tool consistent with the pipeline, which
  // resolves the same site to the same corridor via the shared inferCorridor().
  const [corridor, setCorridor] = useState(() =>
    resolveCorridorForSite(sites[0], corridors, defaultCorridor),
  );
  const [format, setFormat] = useState(sites[0]?.siteType ?? 'inline');
  const [terms, setTerms] = useState({
    baseRentPhpSqm: '1450',
    escalationPct: '5',
    cusaPhpSqm: '180',
    leaseTermYears: '7',
    fitoutMonths: '2',
  });
  const [result, setResult] = useState<LeaseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Generate animation plays only on the Run action.
  const [animating, setAnimating] = useState(false);
  const [pending, setPending] = useState<LeaseResult | null>(null);

  function num(v: string): number | undefined {
    const n = Number(v);
    return v.trim() === '' || !Number.isFinite(n) ? undefined : n;
  }

  async function run() {
    // Guard the essentials up front so the user gets a clear message instead of a
    // silent no-op when a required field is empty.
    if (!corridor.trim()) { setError('Enter a corridor (e.g. BGC, Makati CBD) to compare against.'); return; }
    if (num(terms.baseRentPhpSqm) == null) { setError('Enter the asking base rent (₱/sqm) — it’s the figure we benchmark.'); return; }
    setLoading(true);
    setError(null);
    setAnimating(true);
    const res = await fetch('/api/lease-benchmark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidateSiteId: siteId,
        corridor,
        format,
        siteTerms: {
          baseRentPhpSqm: num(terms.baseRentPhpSqm),
          escalationPct: num(terms.escalationPct),
          cusaPhpSqm: num(terms.cusaPhpSqm),
          leaseTermYears: num(terms.leaseTermYears),
          fitoutMonths: num(terms.fitoutMonths),
        },
      }),
    });
    const json = await res.json();
    setLoading(false);
    if (!json.ok) {
      setAnimating(false);
      setError(json.error?.message ?? 'Benchmark failed.');
      return;
    }
    setPending(json.data); // reveal after the animation completes
  }

  const compValues = result?.comps.map((c) => c.baseRentPhpSqm).filter((v): v is number => v != null) ?? [];

  return (
    <div className="space-y-6">
      <AnalysisOverlay
        feature="lease"
        active={animating}
        onDone={() => { setAnimating(false); if (pending) { setResult(pending); setPending(null); } }}
      />
      {/* controls */}
      <div className="card p-4">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="block">
            <span className="text-sm font-medium text-ink-text">Candidate site</span>
            <select
              value={siteId}
              onChange={(e) => {
                setSiteId(e.target.value);
                const s = sites.find((x) => x.id === e.target.value);
                if (s?.siteType) setFormat(s.siteType);
                // Re-point the corridor at the newly selected site's location so the
                // benchmark compares against the right comps (still user-editable).
                setCorridor(resolveCorridorForSite(s, corridors, defaultCorridor));
              }}
              className="field mt-1"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-text">Corridor</span>
            <input
              list="corridors"
              value={corridor}
              onChange={(e) => setCorridor(e.target.value)}
              className="field mt-1"
            />
            <datalist id="corridors">
              {corridors.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink-text">Format</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)} className="field mt-1">
              <option value="inline">inline</option>
              <option value="mall">mall</option>
              <option value="kiosk">kiosk</option>
            </select>
          </label>
        </div>

        <p className="mt-4 mb-1 text-sm font-medium text-ink-text">Asking lease terms</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {(
            [
              ['baseRentPhpSqm', 'Base rent ₱/sqm'],
              ['escalationPct', 'Escalation %/yr'],
              ['cusaPhpSqm', 'CUSA ₱/sqm'],
              ['leaseTermYears', 'Term (yrs)'],
              ['fitoutMonths', 'Fit-out (mo)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="block">
              <span className="text-xs text-ink-muted">{label}</span>
              <input
                value={terms[key]}
                onChange={(e) => setTerms((t) => ({ ...t, [key]: e.target.value }))}
                className="field mt-1 px-2 py-1.5"
              />
            </label>
          ))}
        </div>

        <button
          onClick={run}
          disabled={loading || !siteId || !corridor}
          className="mt-4 btn-accent"
        >
          {loading ? 'Benchmarking…' : 'Run Lease Benchmark'}
        </button>
        {error && <p className="mt-3 text-sm text-nogo">{error}</p>}
      </div>

      {!result && (
        <p className="rounded-lg border border-dashed border-ink-border p-8 text-center text-ink-muted">
          Enter the asking terms and run to compare against corridor comps.
        </p>
      )}

      {result && (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-6">
            <div className="card p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-ink-text">Base rent vs corridor comps</p>
                <TruthChip layer="verified" title="Comps are Verified against source leases." />
              </div>
              <LeaseDistributionChart
                comps={compValues}
                median={result.baseRentStats?.median ?? null}
                p25={result.baseRentStats?.p25 ?? null}
                p75={result.baseRentStats?.p75 ?? null}
                asking={result.terms.find((t) => t.term === 'baseRentPhpSqm')?.value ?? null}
                verdict={result.verdict}
              />
            </div>

            {/* comparison table */}
            <div className="overflow-hidden card">
              <table className="w-full text-sm">
                <thead className="bg-ink-panel-2 text-left text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Term</th>
                    <th className="px-4 py-2 font-medium">Asking</th>
                    <th className="px-4 py-2 font-medium">Corridor median</th>
                    <th className="px-4 py-2 font-medium">Flag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-border">
                  {result.terms.map((t) => (
                    <tr key={t.term}>
                      <td className="px-4 py-2 text-ink-text">{t.label}</td>
                      <td className="px-4 py-2">{t.value ?? '—'}</td>
                      <td className="px-4 py-2 text-ink-muted">
                        {t.stats ? `${t.stats.median} (n=${t.stats.n})` : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs ${FLAG_META[t.flag].cls}`}>
                          {FLAG_META[t.flag].label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* verdict + stats */}
          <div className="lg:col-span-2 space-y-4">
            <div className="card p-5">
              <p className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-ink-muted">Verdict <InfoHint text="Percentile shows where this asking rent sits versus comparable leases in the same corridor. High percentile = you're likely overpaying, with room to negotiate down toward the median. Low = the rent is competitive for the area." /></p>
              <p className={`mt-1 text-xl font-bold ${VERDICT_META[result.verdict].cls}`}>
                {VERDICT_META[result.verdict].label}
              </p>
              <p className="mt-2 text-sm text-ink-muted">{leaseSummary(result)}</p>
            </div>

            <div className="card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">Base-rent percentile</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">
                    {result.baseRentPercentile != null ? `${result.baseRentPercentile}th` : '—'}
                  </span>
                  <TruthChip layer={result.truth.fairRange} />
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">Negotiating room to median</span>
                <span className="flex items-center gap-2">
                  <span className={`font-semibold ${(result.negotiatingRoomPhpSqm ?? 0) > 0 ? 'text-nogo' : 'text-go'}`}>
                    {result.negotiatingRoomPhpSqm != null
                      ? `₱${result.negotiatingRoomPhpSqm}/sqm (${result.negotiatingRoomPct}%)`
                      : '—'}
                  </span>
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">Sample size</span>
                <span className="font-semibold">{result.sampleSize} comps</span>
              </div>
              {result.lowSample && (
                <p className="rounded-lg bg-assumed/10 px-3 py-2 text-xs text-assumed">
                  Thin sample — the fair-range read is low-confidence. Treat as directional until more comps are observed.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
