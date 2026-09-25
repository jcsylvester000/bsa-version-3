import type { SiteSummary, Tone } from '@/lib/modules/siteVerdict';
import type { TruthLayer } from '@/lib/truth/truthLayer';
import { TruthChip, VERDICT_ICON } from '@/components/ui/Chips';
import { TruthMixBar } from '@/components/ui/Panel';

/**
 * Final Report headline — the call first, in under 5 seconds.
 * Left: solid verdict block (colour + circled icon + word + composite). Right: Judson rationale + meta.
 * Renders the honest-gap state when fewer than 2 core modules have data.
 */
export function FinalReportHero({
  summary,
  composite,
  rank,
  total,
  confidence,
  coverage,
  analysedAt,
  truthPct,
  limited: limitedProp,
}: {
  summary: SiteSummary;
  composite?: number | null;
  rank?: number | null;
  total?: number | null;
  confidence?: 'high' | 'med' | 'low' | null;
  /** e.g. "4 of 4 modules" */
  coverage: string;
  /** Pre-formatted Manila time, e.g. "24 Sep 2026, 3:42 PM" */
  analysedAt?: string | null;
  truthPct?: { verified: number; assumed: number; projected: number } | null;
  /**
   * Show the honest-gap state instead of a call. Defaults to "fewer than 2 core modules rated".
   * The site page passes `true` only when the site has NO composite band — when the band exists it
   * decides the call (audit F-07), so the hero must show the same verdict as the dashboard.
   */
  limited?: boolean;
}) {
  const limited = limitedProp ?? summary.coverage < 2;
  const thinData = !limited && summary.coverage < 2;
  const heroCls = limited ? 'verdict-hero-empty' : `verdict-hero-${summary.tone}`;
  const iconColor = summary.tone === 'go' ? 'text-go' : summary.tone === 'nogo' ? 'text-nogo' : 'text-caution';
  const confLabel = confidence === 'high' ? 'High' : confidence === 'low' ? 'Low' : confidence === 'med' ? 'Medium' : null;
  const confNote = confidence === 'high' ? 'safe to act on with normal diligence' : confidence === 'low' ? 'verify before acting' : 'confirm key assumptions';

  return (
    <section aria-labelledby="verdict-label" className="grid overflow-hidden rounded-hero border border-ink-border bg-ink-panel lg:grid-cols-[400px_minmax(0,1fr)]">
      <div className={heroCls}>
        <div className="flex flex-col gap-4">
          {limited ? (
            <span className="grid h-16 w-16 place-items-center rounded-full border-2 border-dashed border-ink-muted text-2xl text-ink-muted" aria-hidden>—</span>
          ) : (
            <span className={`grid h-16 w-16 place-items-center rounded-full bg-midnight text-[28px] font-bold ${iconColor}`} aria-hidden>{VERDICT_ICON[summary.tone]}</span>
          )}
          <span className="text-overline uppercase tracking-[0.12em]">Recommendation</span>
          <h2 id="verdict-label" className="font-heading text-display !text-current">
            {limited ? 'Not enough data yet' : summary.label}
          </h2>
        </div>
        <div className="flex items-baseline gap-2 border-t border-midnight/25 pt-4">
          {!limited && composite != null ? (
            <>
              <span className="text-5xl font-semibold leading-none tabular-nums">{Math.round(composite)}</span>
              <span className="text-body-lg font-medium">/ 100 composite</span>
            </>
          ) : (
            <span className="text-body">{summary.coverage} of 3 core modules</span>
          )}
          {rank != null && total != null && <span className="ml-auto text-label font-semibold">Rank {rank} of {total}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-6 p-6 md:px-9 md:py-8">
        <p className="rationale text-pretty">{summary.headline}</p>
        {thinData && (
          <p className="text-label font-normal text-ink-muted">
            Limited module data — {summary.coverage} of 3 core modules rated. The call follows the site&apos;s composite score; confirm on the ground.
          </p>
        )}
        <dl className="flex flex-wrap gap-x-7 gap-y-3">
          {confLabel && (
            <div className="flex flex-col gap-1">
              <dt className="overline">Confidence</dt>
              <dd className="text-body-lg font-semibold">{confLabel} <span className="text-label font-normal text-ink-muted">· {confNote}</span></dd>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <dt className="overline">Coverage</dt>
            <dd className="text-body-lg font-semibold">{coverage}</dd>
          </div>
          {analysedAt && (
            <div className="flex flex-col gap-1">
              <dt className="overline">Analysed</dt>
              <dd className="text-body-lg font-semibold">{analysedAt} <span className="text-label font-normal text-ink-muted">Manila</span></dd>
            </div>
          )}
        </dl>
        {truthPct && (
          <div className="flex flex-col gap-2">
            <span className="overline">Where the figures come from</span>
            <TruthMixBar pct={truthPct} />
          </div>
        )}
      </div>
    </section>
  );
}

const FIND_TAB: Record<string, { tab: 'territory' | 'lease' | 'daypart' | 'whitespace'; label: string }> = {
  Cannibalization: { tab: 'territory', label: 'Territory Guard' },
  'Lease position': { tab: 'lease', label: 'Lease Benchmark' },
  'Demand window': { tab: 'daypart', label: 'Daypart Demand' },
  'White-space': { tab: 'whitespace', label: 'White-Space' },
};

/** "What drove this call" — one row per finding: status (icon + word), keyword: detail, figure + chip, tab link. */
export function FindingsList({
  findings,
  keywords,
  figures,
  onOpenTab,
}: {
  findings: SiteSummary['findings'];
  keywords: string[];
  /** Optional headline figure per keyword, e.g. { Cannibalization: { value: '₱182,400 / mo', truth: 'projected' } } */
  figures?: Record<string, { value: string; truth: TruthLayer } | undefined>;
  onOpenTab?: (tab: 'territory' | 'lease' | 'daypart' | 'whitespace') => void;
}) {
  const word = (t: Tone) => (t === 'go' ? 'Proceed' : t === 'nogo' ? 'No-Go' : t === 'caution' ? 'Caution' : 'No data');
  const fill = (t: Tone) => (t === 'go' ? 'bg-go text-go' : t === 'nogo' ? 'bg-nogo text-nogo' : t === 'caution' ? 'bg-caution text-caution' : 'bg-ink-border-strong text-ink-muted');
  return (
    <section className="card flex flex-col gap-4 px-6 py-6 md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-h2">What drove this call</h2>
        <span className="text-label font-normal text-ink-muted">Each finding traces to a module tab</span>
      </div>
      <ul>
        {findings.map((f, i) => {
          const link = FIND_TAB[f.keyword];
          const fig = figures?.[f.keyword];
          const [bg, fg] = fill(f.tone).split(' ');
          return (
            <li key={i} className="grid items-center gap-x-5 gap-y-2 border-t border-ink-border py-3 md:min-h-[64px] md:grid-cols-[150px_minmax(0,1fr)_auto_auto]">
              <span className={`inline-flex items-center gap-2 text-[15px] font-semibold ${fg}`}>
                <span className={`grid h-[26px] w-[26px] place-items-center rounded-full text-xs font-bold text-on-status ${bg}`} aria-hidden>
                  {f.tone === 'muted' ? '—' : VERDICT_ICON[f.tone]}
                </span>
                {word(f.tone)}
              </span>
              <span className="text-body"><b className="font-semibold">{f.keyword}:</b> <span className="text-ink-muted">{f.detail}</span></span>
              {fig ? (
                <span className="inline-flex items-center gap-2 font-semibold tabular-nums md:justify-end">{fig.value}<TruthChip layer={fig.truth} compact /></span>
              ) : <span />}
              {link && onOpenTab ? (
                <button type="button" onClick={() => onOpenTab(link.tab)} className="link min-h-tap text-left md:text-right">{link.label} ›</button>
              ) : <span />}
            </li>
          );
        })}
      </ul>
      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {keywords.map((k) => (
            <span key={k} className="inline-flex min-h-8 items-center rounded-md border border-ink-border bg-ink-panel-2 px-3 text-label font-normal text-ink-text">{k}</span>
          ))}
        </div>
      )}
    </section>
  );
}
