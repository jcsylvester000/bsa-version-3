'use client';

import { useState } from 'react';
import { TruthChip } from '@/components/TruthChip';
import { ScoreBar } from '@/components/ui/Panel';
import { ReportDownloadModal } from '@/components/ReportDownloadModal';
import type { TruthLayer, Confidence } from '@/lib/truth/truthLayer';

interface ReportMetric {
  siteLabel: string;
  label: string;
  score?: number | null;
  value?: string;
  verdict?: string;
  truthLayer: TruthLayer;
  range?: { min: number; median: number; max: number; n: number };
  higherIsBetter?: boolean;
  note?: string;
}
interface Section {
  number: number;
  title: string;
  text: string;
  truthLayers: TruthLayer[];
  assessed: boolean;
  metrics: ReportMetric[];
}
interface ReportData {
  reportId: string;
  confidence: Confidence;
  truthLayerMix: Record<TruthLayer, number>;
  sections: Section[];
  downloadUrl: string;
}

const CONF_META: Record<Confidence, { label: string; cls: string }> = {
  high: { label: 'High', cls: 'text-go' },
  med: { label: 'Medium', cls: 'text-caution' },
  low: { label: 'Low', cls: 'text-nogo' },
};

/** Verdict → pill styling. Green = good, red = risk, amber = mixed/neutral. */
function verdictPill(v: string | undefined): { label: string; cls: string } | null {
  if (!v) return null;
  const key = v.toLowerCase();
  const good = ['adds', 'below_market', 'go', 'screen_pass', 'strong'];
  const bad = ['redistributes', 'above_market', 'nogo', 'no-go', 'screen_fail'];
  const label = key.replace(/_/g, ' ');
  if (good.includes(key)) return { label, cls: 'bg-go/15 text-go' };
  if (bad.includes(key)) return { label, cls: 'bg-nogo/15 text-nogo' };
  return { label, cls: 'bg-accent/15 text-accent' };
}

/** Band a 0–100 score, respecting whether higher is better. */
function bandFor(score: number, higherIsBetter: boolean): 'go' | 'caution' | 'nogo' {
  const s = higherIsBetter ? score : 100 - score;
  return s >= 70 ? 'go' : s >= 45 ? 'caution' : 'nogo';
}

export function ReportView({ runId, existing }: { runId: string; existing: { downloadUrl: string; confidence: Confidence } | null }) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    const res = await fetch('/api/reports', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    });
    const json = await res.json();
    setLoading(false);
    if (!json.ok) {
      setError(json.error?.message ?? 'Report generation failed.');
      return;
    }
    setReport(json.data);
  }

  return (
    <div className="space-y-6">
      <div className="card p-4 print:hidden">
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={generate} disabled={loading} className="btn-ghost">
            {loading ? 'Composing…' : report ? 'Regenerate' : 'Generate report'}
          </button>
          {/* The full branded, client-ready download — available once a report exists for the run. */}
          {(report || existing) && <ReportDownloadModal runId={runId} />}
          <p className="text-xs text-ink-muted">
            A complete, branded report — cover, all sections, per-site scorecards and the Truth-Layer confidence read.
            Add client details, then print to PDF. Every figure carries its Truth Layer; nothing is AI-phrased.
          </p>
        </div>
        {error && <p className="mt-3 text-sm text-nogo">{error}</p>}
      </div>

      {!report && !existing && (
        <p className="rounded-lg border border-dashed border-ink-border p-8 text-center text-ink-muted">
          Generate to compose the Site Intelligence Report from this run’s module results.
        </p>
      )}

      {!report && existing && (
        <p className="rounded-lg card p-5 text-sm text-ink-muted">
          A report already exists for this run (confidence {existing.confidence}). Use the download link above, or
          regenerate to refresh it from the latest module results.
        </p>
      )}

      {report && (
        <>
          {/* Confidence header + Truth-Layer segmented bar */}
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-muted">Overall confidence</p>
                <p className={`text-2xl font-bold ${CONF_META[report.confidence].cls}`}>{CONF_META[report.confidence].label}</p>
              </div>
              <div className="flex gap-2 text-sm">
                <span className="tl-chip tl-verified">{report.truthLayerMix.verified} Verified</span>
                <span className="tl-chip tl-assumed">{report.truthLayerMix.assumed} Assumed</span>
                <span className="tl-chip tl-projected">{report.truthLayerMix.projected} Projected</span>
              </div>
            </div>
            <TruthMixBar mix={report.truthLayerMix} />
          </div>

          <div className="space-y-4">
            {report.sections.map((s) => (
              <section key={s.number} className="card p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-ink-text">{s.number}. {s.title}</h3>
                  <div className="flex gap-1">
                    {s.truthLayers.map((l) => <TruthChip key={l} layer={l} />)}
                  </div>
                </div>

                {!s.assessed ? (
                  <p className="rounded-lg border border-dashed border-ink-border p-4 text-sm italic text-ink-muted">
                    Not assessed for this run — no supporting module data was produced. Left blank rather than estimated.
                  </p>
                ) : s.metrics.length === 0 ? (
                  // The confidence section has no per-site metrics; the header bar above covers it.
                  <p className="text-sm text-ink-muted">
                    Confidence is derived from the Truth-Layer mix shown at the top — Verified (measured/sourced),
                    Assumed (estimate with basis), Projected (modelled).
                  </p>
                ) : (
                  <div className="space-y-4">
                    {groupBySite(s.metrics).map(([siteLabel, metrics]) => (
                      <div key={siteLabel} className="card-inset p-4">
                        <p className="mb-3 text-sm font-medium text-ink-text">{siteLabel}</p>
                        <div className="space-y-3">
                          {metrics.map((m, i) => <MetricRow key={i} m={m} />)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** One metric → a labelled score bar, a range chart, or a value + verdict pill. */
function MetricRow({ m }: { m: ReportMetric }) {
  const pill = verdictPill(m.verdict);
  const higher = m.higherIsBetter ?? true;
  return (
    <div className="grid grid-cols-12 items-center gap-3">
      <div className="col-span-12 sm:col-span-4">
        <p className="text-sm text-ink-text">{m.label}</p>
        <p className="text-[11px] text-ink-muted">
          <TruthChip layer={m.truthLayer} />{m.note ? ` · ${m.note}` : ''}
        </p>
      </div>
      <div className="col-span-8 sm:col-span-6">
        {m.range ? (
          <RangeChart range={m.range} />
        ) : m.score != null ? (
          <ScoreBar score={m.score} band={bandFor(m.score, higher)} />
        ) : m.value ? (
          <p className="text-sm text-ink-text">{m.value}</p>
        ) : (
          <div className="h-1.5 w-full rounded-full bg-ink-panel-2" />
        )}
      </div>
      <div className="col-span-4 text-right sm:col-span-2">
        {m.score != null ? (
          <span className={`text-lg font-bold ${scoreColor(bandFor(m.score, higher))}`}>{Math.round(m.score)}</span>
        ) : pill ? (
          <span className={`rounded px-2 py-0.5 text-[11px] font-medium capitalize ${pill.cls}`}>{pill.label}</span>
        ) : <span className="text-ink-muted">—</span>}
      </div>
    </div>
  );
}

/** Corridor rent range: a min–median–max bar with a median marker. */
function RangeChart({ range }: { range: { min: number; median: number; max: number; n: number } }) {
  const span = Math.max(1, range.max - range.min);
  const medianPct = ((range.median - range.min) / span) * 100;
  return (
    <div>
      <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-go/40 via-caution/40 to-nogo/40">
        <div className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-ink-text" style={{ left: `${medianPct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-muted">
        <span>₱{range.min.toLocaleString()}</span>
        <span className="font-medium text-ink-text">median ₱{range.median.toLocaleString()} · n={range.n}</span>
        <span>₱{range.max.toLocaleString()}</span>
      </div>
    </div>
  );
}

/** Truth-Layer mix as a single stacked segmented bar. */
function TruthMixBar({ mix }: { mix: Record<TruthLayer, number> }) {
  const total = Math.max(1, mix.verified + mix.assumed + mix.projected);
  const seg = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full">
      <div className="bg-verified" style={{ width: seg(mix.verified) }} title={`${mix.verified} Verified`} />
      <div className="bg-assumed" style={{ width: seg(mix.assumed) }} title={`${mix.assumed} Assumed`} />
      <div className="bg-projected" style={{ width: seg(mix.projected) }} title={`${mix.projected} Projected`} />
    </div>
  );
}

function scoreColor(band: 'go' | 'caution' | 'nogo'): string {
  return band === 'go' ? 'text-go' : band === 'nogo' ? 'text-nogo' : 'text-caution';
}

function groupBySite(metrics: ReportMetric[]): Array<[string, ReportMetric[]]> {
  const map = new Map<string, ReportMetric[]>();
  for (const m of metrics) {
    const arr = map.get(m.siteLabel) ?? [];
    arr.push(m);
    map.set(m.siteLabel, arr);
  }
  return Array.from(map.entries());
}
