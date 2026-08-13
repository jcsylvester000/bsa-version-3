'use client';

/**
 * AnalysisSequence — an 8-second futuristic "the system is computing" overlay that
 * plays on every data load, then reveals the real (already-loaded) content beneath.
 *
 * It narrates a believable series of tasks (streaming status log) alongside a motif
 * unique to each feature (radar sweep, grid pulse, growing bars, demand curve, scan,
 * network) — purely cosmetic; the data is instant underneath. Respects
 * prefers-reduced-motion (skips straight to content) and can be disabled per call.
 *
 * Usage:
 *   <AnalysisSequence feature="territory"> <TerritoryGuardView ... /> </AnalysisSequence>
 */
import { useEffect, useRef, useState } from 'react';
import { analysisConfig, ANALYSIS_DURATION_MS, type Motif } from '@/lib/ui/analysisSteps';

interface Props {
  feature: string;
  children: React.ReactNode;
  /** Override total duration (ms). Defaults to 8000. */
  durationMs?: number;
  /** Skip the animation entirely (e.g. tests, or a "seen this session" flag). */
  disabled?: boolean;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * AnalysisOverlay — the SAME animation, but ACTION-triggered. Render it with
 * `active` while a "generate result" action runs (e.g. Run Territory Guard, Run Lease
 * Benchmark, Submit intake). It plays the full sequence then calls `onDone`. Use this
 * instead of the mount-triggered <AnalysisSequence> wrapper when the animation should
 * only appear on a deliberate generate action, not on every page load.
 */
export function AnalysisOverlay({ feature, active, onDone, durationMs = ANALYSIS_DURATION_MS }: { feature: string; active: boolean; onDone: () => void; durationMs?: number }) {
  const cfg = analysisConfig(feature);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [pct, setPct] = useState(0);
  const [closing, setClosing] = useState(false);
  // Always call the LATEST onDone (which reads the latest pendingRunId), not the one
  // captured when the animation started — otherwise navigation uses a stale closure.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (!active) return;
    if (prefersReducedMotion()) { onDoneRef.current(); return; }
    setVisibleSteps(0); setPct(0); setClosing(false);
    const start = performance.now();
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const stepWindow = durationMs * 0.85;
    cfg.steps.forEach((_, i) => timers.push(setTimeout(() => setVisibleSteps(i + 1), Math.round((i / cfg.steps.length) * stepWindow))));
    const tick = () => {
      const elapsed = performance.now() - start;
      setPct(Math.min(100, (elapsed / durationMs) * 100));
      if (elapsed < durationMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    timers.push(setTimeout(() => setClosing(true), durationMs));
    timers.push(setTimeout(() => onDoneRef.current(), durationMs + 450));
    return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, feature, durationMs]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-bg/80 p-4 backdrop-blur-sm">
      <div className={`relative w-full max-w-3xl overflow-hidden rounded-2xl border border-ink-border bg-ink-panel-2 ${closing ? 'as-overlay-out' : 'as-overlay'}`} role="status" aria-live="polite" aria-label={`${cfg.title} — analyzing`}>
        <div className="as-gridbg absolute inset-0 opacity-60" />
        <div className="pointer-events-none absolute inset-0"><div className="as-scan absolute top-0 h-full w-24 bg-gradient-to-r from-transparent via-accent/20 to-transparent" /></div>
        <div className="relative grid min-h-[380px] gap-6 p-6 md:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col">
            <div className="mb-4 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-accent as-cursor" />
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{cfg.title}</span>
              <span className="ml-auto font-mono text-xs text-ink-muted">{Math.round(pct)}%</span>
            </div>
            <div className="flex-1 space-y-1.5 font-mono text-[13px] leading-relaxed">
              {cfg.steps.slice(0, visibleSteps).map((s, i) => {
                const isLast = i === visibleSteps - 1;
                return (
                  <div key={i} className="as-reveal flex items-start gap-2">
                    <span className={isLast ? 'text-accent' : 'text-verified'}>{isLast ? '▸' : '✓'}</span>
                    <span className={isLast ? 'text-ink-text' : 'text-ink-muted'}>{s}{isLast && <span className="as-cursor ml-0.5 text-accent">▊</span>}</span>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-border/60">
              <div className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent transition-[width] duration-150 ease-linear" style={{ width: `${pct}%` }} />
            </div>
          </div>
          <div className="relative hidden items-center justify-center md:flex"><Motif kind={cfg.motif} /></div>
        </div>
      </div>
    </div>
  );
}

export function AnalysisSequence({ feature, children, durationMs = ANALYSIS_DURATION_MS, disabled }: Props) {
  const cfg = analysisConfig(feature);
  const [phase, setPhase] = useState<'running' | 'closing' | 'done'>(
    disabled ? 'done' : 'running',
  );
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [pct, setPct] = useState(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    if (disabled || prefersReducedMotion()) {
      setPhase('done');
      return;
    }
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    startRef.current = performance.now();

    // Stream the steps evenly across ~85% of the duration (last 15% = final line dwell).
    const stepWindow = durationMs * 0.85;
    cfg.steps.forEach((_, i) => {
      timers.push(
        setTimeout(() => setVisibleSteps(i + 1), Math.round((i / cfg.steps.length) * stepWindow)),
      );
    });

    // Smooth progress bar.
    const tick = () => {
      const elapsed = performance.now() - startRef.current;
      setPct(Math.min(100, (elapsed / durationMs) * 100));
      if (elapsed < durationMs) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Close, then reveal.
    timers.push(setTimeout(() => setPhase('closing'), durationMs));
    timers.push(setTimeout(() => setPhase('done'), durationMs + 500));

    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
    // Re-run only if the feature or duration changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feature, durationMs, disabled]);

  if (phase === 'done') {
    return <div className={disabled ? undefined : 'as-reveal'}>{children}</div>;
  }

  return (
    <div className="relative min-h-[420px]">
      {/* Keep the real content mounted but hidden so it's instant on reveal. */}
      <div className="pointer-events-none opacity-0" aria-hidden>{children}</div>

      <div
        className={`absolute inset-0 z-10 overflow-hidden rounded-2xl border border-ink-border bg-ink-panel-2 ${phase === 'closing' ? 'as-overlay-out' : 'as-overlay'}`}
        role="status"
        aria-live="polite"
        aria-label={`${cfg.title} — analyzing`}
      >
        {/* Moving grid backdrop */}
        <div className="as-gridbg absolute inset-0 opacity-60" />
        {/* Horizontal scan line */}
        <div className="pointer-events-none absolute inset-0">
          <div className="as-scan absolute top-0 h-full w-24 bg-gradient-to-r from-transparent via-accent/20 to-transparent" style={{ position: 'absolute' }} />
        </div>

        <div className="relative grid h-full min-h-[420px] gap-6 p-6 md:grid-cols-[1.1fr_1fr]">
          {/* Left: streaming console log */}
          <div className="flex flex-col">
            <div className="mb-4 flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-accent as-cursor" />
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">{cfg.title}</span>
              <span className="ml-auto font-mono text-xs text-ink-muted">{Math.round(pct)}%</span>
            </div>

            <div className="flex-1 space-y-1.5 font-mono text-[13px] leading-relaxed">
              {cfg.steps.slice(0, visibleSteps).map((s, i) => {
                const isLast = i === visibleSteps - 1;
                return (
                  <div key={i} className="as-reveal flex items-start gap-2">
                    <span className={isLast ? 'text-accent' : 'text-verified'}>{isLast ? '▸' : '✓'}</span>
                    <span className={isLast ? 'text-ink-text' : 'text-ink-muted'}>
                      {s}
                      {isLast && <span className="as-cursor ml-0.5 text-accent">▊</span>}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Progress bar */}
            <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-ink-border/60">
              <div className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent transition-[width] duration-150 ease-linear" style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* Right: the feature's unique motif */}
          <div className="relative hidden items-center justify-center md:flex">
            <Motif kind={cfg.motif} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------- *
 * Motifs — one per feature family. Pure SVG/DIV motion driven by the CSS
 * keyframes in globals.css. Colours use the theme tokens.
 * ------------------------------------------------------------------------- */
function Motif({ kind }: { kind: Motif }) {
  switch (kind) {
    case 'radar':
      return <RadarMotif />;
    case 'grid':
      return <GridMotif />;
    case 'bars':
      return <BarsMotif />;
    case 'curve':
      return <CurveMotif />;
    case 'network':
      return <NetworkMotif />;
    case 'scan':
    default:
      return <ScanMotif />;
  }
}

function RadarMotif() {
  return (
    <svg viewBox="0 0 200 200" className="h-56 w-56">
      {[70, 50, 30].map((r) => (
        <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="#1d2c4d" strokeWidth="1" />
      ))}
      <line x1="20" y1="100" x2="180" y2="100" stroke="#1d2c4d" strokeWidth="1" />
      <line x1="100" y1="20" x2="100" y2="180" stroke="#1d2c4d" strokeWidth="1" />
      {/* ping ring */}
      <circle cx="100" cy="100" r="70" fill="none" stroke="#e0a568" strokeWidth="1.5" className="as-radar-ping" style={{ transformOrigin: '100px 100px' }} />
      {/* sweep wedge */}
      <g className="as-radar-line" style={{ transformOrigin: '100px 100px' }}>
        <defs>
          <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#e0a568" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#e0a568" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M100 100 L100 30 A70 70 0 0 1 160 70 Z" fill="url(#sweep)" />
        <line x1="100" y1="100" x2="100" y2="30" stroke="#e0a568" strokeWidth="1.5" />
      </g>
      {/* blips */}
      <circle cx="132" cy="76" r="3" fill="#38a574" />
      <circle cx="78" cy="128" r="3" fill="#9b7bd4" />
      <circle cx="120" cy="130" r="3" fill="#d9a441" />
    </svg>
  );
}

function GridMotif() {
  const cells = Array.from({ length: 36 });
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {cells.map((_, i) => (
        <div
          key={i}
          className="as-cell h-7 w-7 rounded-[3px] bg-accent"
          style={{ animationDelay: `${(i % 6) * 0.12 + Math.floor(i / 6) * 0.08}s` }}
        />
      ))}
    </div>
  );
}

function BarsMotif() {
  const heights = [40, 62, 78, 90, 72, 55, 84, 48];
  return (
    <div className="flex h-52 items-end gap-2">
      {heights.map((h, i) => (
        <div key={i} className="flex w-6 flex-col items-center">
          <div
            className="as-bar w-full rounded-t bg-gradient-to-t from-accent/40 to-accent"
            style={{ height: `${h}%`, animationDelay: `${i * 0.12}s` }}
          />
        </div>
      ))}
    </div>
  );
}

function CurveMotif() {
  return (
    <svg viewBox="0 0 220 160" className="h-52 w-64">
      <defs>
        <linearGradient id="cv" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e0a568" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#e0a568" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[40, 80, 120].map((y) => (
        <line key={y} x1="10" y1={y} x2="210" y2={y} stroke="#1d2c4d" strokeWidth="1" />
      ))}
      <path
        d="M10 130 C 50 130, 55 60, 90 55 S 140 110, 170 60 S 205 70, 210 66 L210 150 L10 150 Z"
        fill="url(#cv)"
      />
      <path
        d="M10 130 C 50 130, 55 60, 90 55 S 140 110, 170 60 S 205 70, 210 66"
        fill="none"
        stroke="#e0a568"
        strokeWidth="2"
        strokeDasharray="420"
        style={{ animation: 'as-ring-dash 3s ease-out both' }}
      />
      <circle cx="90" cy="55" r="3.5" fill="#38a574" />
      <circle cx="170" cy="60" r="3.5" fill="#9b7bd4" />
    </svg>
  );
}

function NetworkMotif() {
  const nodes = [
    [110, 30], [50, 70], [170, 65], [70, 130], [150, 130], [110, 90],
  ];
  const links: [number, number][] = [[5, 0], [5, 1], [5, 2], [5, 3], [5, 4]];
  return (
    <svg viewBox="0 0 220 160" className="h-52 w-64">
      {links.map(([a, b], i) => (
        <line key={i} x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke="#1d2c4d" strokeWidth="1.5" className="as-cell" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
      {nodes.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={i === 5 ? 6 : 4} fill={i === 5 ? '#e0a568' : '#38a574'} className="as-cell" style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </svg>
  );
}

function ScanMotif() {
  return (
    <div className="relative h-52 w-52">
      <svg viewBox="0 0 100 100" className="h-full w-full">
        <circle cx="50" cy="50" r="46" fill="none" stroke="#1d2c4d" strokeWidth="3" />
        <circle
          cx="50" cy="50" r="46" fill="none" stroke="#e0a568" strokeWidth="3"
          strokeLinecap="round" strokeDasharray="289" className="as-ring-stroke"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="as-spin h-10 w-10 rounded-full border-2 border-accent/30 border-t-accent" />
      </div>
    </div>
  );
}
