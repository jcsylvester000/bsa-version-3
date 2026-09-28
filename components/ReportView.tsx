'use client';

import { useState } from 'react';
import { TruthChip, StatusText } from '@/components/ui/Chips';
import { ScoreBar, TruthMixBar } from '@/components/ui/Panel';
import { fmtInt } from '@/lib/util/format';
import { ReportDownloadModal } from '@/components/ReportDownloadModal';
import { LEASE_POSITION_LABEL } from '@/lib/truth/guardrailCopy';
import type { TruthLayer, Confidence } from '@/lib/truth/truthLayer';

/**
 * Run Report (all sites) — design v2 layout.
 * `ReportView` (client) composes the report on demand via POST /api/reports; `ReportBody` is the
 * presentational part, also used by the demo (mock) report on the server page. Every figure keeps its
 * Truth Layer chip; statuses are icon + word; rent position is never coloured good/bad.
 */

export interface ReportMetric {
  siteLabel: string;
  label: string;
  score?: number | null;
  value?: string;
  verdict?: string;
  truthLayer: TruthLayer;
  range?: { min: number; median: number; max: number; n: number };
  higherIsBetter?: boolean;
  /** Position statement (rent vs corridor) — render without good/bad colour. */
  neutral?: boolean;
  note?: string;
}
export interface ReportSection {
  number: number;
  title: string;
  text: string;
  truthLayers: TruthLayer[];
  assessed: boolean;
  metrics?: ReportMetric[];
}
export interface ReportData {
  confidence: Confidence;
  truthLayerMix: Record<TruthLayer, number>;
  sections: ReportSection[];
}

const CONF_META: Record<Confidence, { label: string; note: string; tone: 'go' | 'caution' | 'nogo' }> = {
  high: { label: 'High', note: 'safe to act on with normal diligence', tone: 'go' },
  med: { label: 'Medium', note: 'confirm key assumptions', tone: 'caution' },
  low: { label: 'Low', note: 'verify before acting', tone: 'nogo' },
};

type Tone = 'go' | 'caution' | 'nogo' | 'muted';

/** Verdict word → status tone + readable label. Lease positions are statements (muted). */
function verdictStatus(v: string | undefined): { tone: Tone; label: string } | null {
  if (!v) return null;
  const key = v.toLowerCase().trim();
  if (!key) return null;
  if (key in LEASE_POSITION_LABEL) return { tone: 'muted', label: LEASE_POSITION_LABEL[key as keyof typeof LEASE_POSITION_LABEL] };
  if (key === 'corridor benchmark') return { tone: 'muted', label: 'Corridor benchmark' };
  const good = ['adds', 'go', 'screen_pass', 'strong', 'proceed'];
  const bad = ['redistributes', 'nogo', 'no-go', 'no_go', 'screen_fail'];
  const label = key.replace(/_/g, ' ');
  const nice = label.charAt(0).toUpperCase() + label.slice(1);
  if (good.includes(key)) return { tone: 'go', label: nice };
  if (bad.includes(key)) return { tone: 'nogo', label: nice };
  return { tone: 'caution', label: nice };
}

/** Band a 0–100 score, respecting whether higher is better. */
function bandFor(score: number, higherIsBetter: boolean): 'go' | 'caution' | 'nogo' {
  const s = higherIsBetter ? score : 100 - score;
  return s >= 70 ? 'go' : s >= 45 ? 'caution' : 'nogo';
}

function mixPct(mix: Record<TruthLayer, number>) {
  const n = mix.verified + mix.assumed + mix.projected || 1;
  return {
    verified: Math.round((mix.verified / n) * 100),
    assumed: Math.round((mix.assumed / n) * 100),
    projected: Math.round((mix.projected / n) * 100),
  };
}

export function ReportView({ runId, existing }: { runId: string; existing: { confidence: Confidence } | null }) {
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.ok) { setError(json?.error?.message ?? 'Report generation failed.'); return; }
      setReport(json.data as ReportData);
    } catch {
      setError('The request failed — check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Actions — one primary per view: the client-ready download once a report exists. */}
      <section className="card flex flex-col gap-4 p-5 print:hidden lg:flex-row lg:items-center lg:justify-between">
        <p className="max-w-2xl text-body text-ink-muted">
          A complete, branded report — cover, all sections, per-site scorecards and the confidence read. Add client
          details, then print to PDF. Every figure carries its Truth Layer; nothing is AI-phrased.
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={generate} disabled={loading} className={report || existing ? 'btn-secondary btn-lg' : 'btn-primary btn-lg'}>
            {loading ? 'Composing…' : report ? '↻ Regenerate' : 'View report here'}
          </button>
          {(report || existing) && <ReportDownloadModal runId={runId} />}
        </div>
      </section>

      {error && (
        <div role="alert" className="error-state flex-row items-start gap-2 p-4 text-body">
          <span className="font-bold text-nogo" aria-hidden>✕</span> <span>{error}</span>
        </div>
      )}

      {loading && !report && (
        <div className="space-y-4" aria-busy="true" aria-label="Composing the report">
          <div className="skeleton h-32" />
          <div className="skeleton h-48" />
          <div className="skeleton h-48" />
        </div>
      )}

      {!loading && !report && !existing && (
        <div className="empty-state">
          <p className="text-title">No report yet</p>
          <p className="text-body text-ink-muted">Compose the Run Report from this run’s latest module results. It takes a few seconds.</p>
        </div>
      )}

      {!loading && !report && existing && (
        <div className="empty-state">
          <p className="text-title">A report exists for this run</p>
          <p className="text-body text-ink-muted">
            Last composed with <b className="text-ink-text">{CONF_META[existing.confidence].label}</b> confidence. The download is rebuilt from the
            latest module results each time — or choose <b className="text-ink-text">View report here</b> to read the sections on this page.
          </p>
        </div>
      )}

      {report && <ReportBody report={report} />}
    </div>
  );
}

/** Presentational report: summary strip, "On this page" index, numbered sections. No hooks. */
export function ReportBody({ report }: { report: ReportData }) {
  const conf = CONF_META[report.confidence];
  const assessed = report.sections.filter((s) => s.assessed).length;
  const pct = mixPct(report.truthLayerMix);

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="card flex flex-col gap-2 p-5">
          <span className="overline">Overall confidence</span>
          <span className="text-h2"><StatusText tone={conf.tone}>{conf.label}</StatusText></span>
          <span className="text-label font-normal text-ink-muted">{conf.note}</span>
        </div>
        <div className="card flex flex-col gap-2 p-5">
          <span className="overline">Sections assessed</span>
          <span className="text-stat tabular-nums">{assessed} <span className="text-body font-normal text-ink-muted">of {report.sections.length}</span></span>
          <span className="text-label font-normal text-ink-muted">Unassessed sections are left blank, never estimated.</span>
        </div>
        <div className="card flex flex-col gap-3 p-5">
          <span className="overline">Where the figures come from</span>
          <TruthMixBar pct={pct} />
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[220px_minmax(0,1fr)]">
        {/* On this page */}
        <nav aria-label="Report sections" className="hidden xl:sticky xl:top-6 xl:block">
          <p className="overline mb-2 px-3">On this page</p>
          <ol className="space-y-0.5">
            {report.sections.map((s) => (
              <li key={s.number}>
                <a href={`#section-${s.number}`} className={`nav-item min-h-[40px] text-label ${s.assessed ? '' : 'opacity-70'}`}>
                  <span className="w-5 shrink-0 tabular-nums text-ink-muted">{s.number}</span>
                  <span className="truncate">{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="space-y-5">
          {report.sections.map((s) => <SectionCard key={s.number} s={s} />)}
        </div>
      </div>
    </div>
  );
}

function SectionCard({ s }: { s: ReportSection }) {
  const metrics = s.metrics ?? [];
  return (
    <section id={`section-${s.number}`} aria-labelledby={`section-${s.number}-title`} className="card scroll-mt-6 p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <h2 id={`section-${s.number}-title`} className="flex items-center gap-3 text-h3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-hover font-body text-label font-semibold text-accent-text" aria-hidden>{s.number}</span>
          {s.title}
        </h2>
        {s.truthLayers.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {s.truthLayers.map((l) => <TruthChip key={l} layer={l} />)}
          </div>
        )}
      </div>

      {!s.assessed ? (
        <div className="empty-state p-4">
          <p className="text-body text-ink-muted">
            <span className="font-semibold text-ink-text">— Not assessed for this run.</span> No supporting module data was produced, so this
            section is left blank rather than estimated.
          </p>
        </div>
      ) : metrics.length > 0 ? (
        <div className="space-y-4">
          {groupBySite(metrics).map(([siteLabel, ms]) => (
            <div key={siteLabel} className="card-inset overflow-hidden">
              <p className="border-b border-ink-border px-4 py-3 text-body font-semibold">{siteLabel}</p>
              <div className="divide-y divide-ink-border">
                {ms.map((m, i) => <MetricRow key={i} m={m} />)}
              </div>
            </div>
          ))}
        </div>
      ) : s.text ? (
        <SectionText text={s.text} />
      ) : (
        <p className="text-body text-ink-muted">
          Confidence is derived from the Truth Layer mix above — Verified (measured / sourced), Assumed (estimate with a
          stated basis), Projected (modelled).
        </p>
      )}
    </section>
  );
}

/** Plain-text section body: "- " lines become a list, anything else a paragraph. */
function SectionText({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => l.startsWith('- '));
  if (bullets.length === lines.length) {
    return (
      <ul className="list-disc space-y-1.5 pl-5 text-body text-ink-text marker:text-ink-muted">
        {bullets.map((b, i) => <li key={i}>{b.slice(2)}</li>)}
      </ul>
    );
  }
  return <p className="whitespace-pre-wrap text-body text-ink-text">{text}</p>;
}

/** One metric → label + chip, a bar / range / value, and the score or status on the right. */
function MetricRow({ m }: { m: ReportMetric }) {
  const status = verdictStatus(m.verdict);
  const higher = m.higherIsBetter ?? true;
  const band = m.score != null && !m.neutral ? bandFor(m.score, higher) : undefined;
  return (
    <div className="grid gap-x-5 gap-y-2 px-4 py-3.5 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.9fr)] md:items-center">
      <div className="min-w-0">
        <p className="flex items-center gap-2 text-body text-ink-text">
          {m.label}
          <TruthChip layer={m.truthLayer} compact />
        </p>
        {m.note && <p className="text-label font-normal text-ink-muted">{m.note}</p>}
      </div>
      <div>
        {m.range ? (
          <RangeChart range={m.range} />
        ) : m.score != null ? (
          <div className="flex items-center gap-3">
            <span className="w-10 text-title tabular-nums">{Math.round(m.score)}</span>
            <span className="flex-1"><ScoreBar score={m.score} band={band} /></span>
          </div>
        ) : m.value ? (
          <p className="text-body font-semibold text-ink-text">{m.value}</p>
        ) : (
          <p className="text-body text-ink-muted">—</p>
        )}
      </div>
      <div className="md:text-right">
        {status ? <StatusText tone={status.tone}>{status.label}</StatusText> : <span className="text-ink-muted">—</span>}
      </div>
    </div>
  );
}

/** Corridor rent range: min–median–max with a median marker. Neutral colour — a spread, not a judgement. */
function RangeChart({ range }: { range: { min: number; median: number; max: number; n: number } }) {
  const span = Math.max(1, range.max - range.min);
  const medianPct = ((range.median - range.min) / span) * 100;
  return (
    <div>
      <div className="relative h-2 w-full rounded-full bg-ink-panel-2" role="img" aria-label={`Corridor rent ₱${fmtInt(range.min)} to ₱${fmtInt(range.max)} per sqm, median ₱${fmtInt(range.median)}, ${range.n} leases`}>
        <div className="absolute inset-y-0 left-0 right-0 rounded-full bg-accent/35" />
        <div className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded bg-ink-text" style={{ left: `calc(${medianPct}% - 2px)` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-label font-normal text-ink-muted">
        <span>₱{fmtInt(range.min)}</span>
        <span className="font-semibold text-ink-text">median ₱{fmtInt(range.median)} · n={range.n}</span>
        <span>₱{fmtInt(range.max)}</span>
      </div>
    </div>
  );
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
