'use client';

/**
 * Daypart demand curve — demand across the day as a filled area chart with the
 * format's peak window marked, plus a peak-hour share bar. Dark theme, matches the
 * mockup. dataviz: area = magnitude over time (single series → no legend, title
 * names it); recessive axes; the peak window uses the brand accent as a highlight.
 */
export interface DaypartData {
  /** 24 hourly demand values 0–100 (index = hour). */
  hourly: number[];
  /** Peak window [startHour, endHour]. */
  window: [number, number];
  windowMatchPct: number;
}

export function DaypartCurve({ data }: { data: DaypartData }) {
  const W = 560, H = 200, padX = 30, padTop = 20, padBottom = 26;
  const plotH = H - padTop - padBottom;
  const n = data.hourly.length; // 24
  const max = Math.max(1, ...data.hourly);
  const xOf = (h: number) => padX + (h / (n - 1)) * (W - 2 * padX);
  const yOf = (v: number) => padTop + plotH * (1 - v / max);

  const line = data.hourly.map((v, h) => `${h === 0 ? 'M' : 'L'} ${xOf(h).toFixed(1)} ${yOf(v).toFixed(1)}`).join(' ');
  const area = `${line} L ${xOf(n - 1)} ${padTop + plotH} L ${xOf(0)} ${padTop + plotH} Z`;

  const [ws, we] = data.window;
  const ticks = [0, 6, 12, 18, 23];
  const label = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Demand across the day; peak window ${label(ws)}–${label(we)}; ${data.windowMatchPct}% of demand inside it.`}>
        <defs>
          <linearGradient id="daypartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#38a574" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#38a574" stopOpacity="0.03" />
          </linearGradient>
        </defs>

        {/* peak window band */}
        <rect x={xOf(ws)} y={padTop} width={xOf(we) - xOf(ws)} height={plotH} fill="#e0a568" opacity={0.1} rx={4} />

        {/* area + line */}
        <path d={area} fill="url(#daypartFill)" />
        <path d={line} fill="none" stroke="#38a574" strokeWidth={2} />

        {/* peak window label */}
        <text x={(xOf(ws) + xOf(we)) / 2} y={padTop + 12} textAnchor="middle" fontSize={10} fill="#e0a568">
          peak {label(ws)}–{label(we)}
        </text>

        {/* baseline + x ticks */}
        <line x1={padX} y1={padTop + plotH} x2={W - padX} y2={padTop + plotH} stroke="#1d2c4d" strokeWidth={1} />
        {ticks.map((h) => (
          <text key={h} x={xOf(h)} y={padTop + plotH + 15} textAnchor="middle" fontSize={9} fill="#8c96a8">{label(h)}</text>
        ))}
      </svg>

      {/* peak-hour share bar */}
      <div className="mt-3">
        <div className="flex overflow-hidden rounded-lg">
          <div className="bg-verified py-1.5 text-center text-xs font-medium text-ink-bg" style={{ width: `${data.windowMatchPct}%` }}>
            {Math.round(data.windowMatchPct * 10) / 10}% in peak hours
          </div>
          <div className="flex-1 bg-ink-panel-2 py-1.5 text-center text-xs text-ink-muted">{Math.round((100 - data.windowMatchPct) * 10) / 10}%</div>
        </div>
      </div>
    </div>
  );
}
