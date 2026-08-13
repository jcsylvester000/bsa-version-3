'use client';

/**
 * Lease rent distribution — dark theme, matching the mockup: comparable leases as
 * vertical bars sorted low→high, the corridor median marked, and the site's asking
 * rate as a highlighted bar/line. Inline SVG (dataviz: bar = magnitude by identity;
 * status colour reserved for the verdict; recessive axes; single series → no legend).
 */
interface Props {
  comps: number[];
  median: number | null;
  p25: number | null;
  p75: number | null;
  asking: number | null;
  verdict: 'below_market' | 'at_market' | 'above_market' | 'insufficient_data' | 'corridor_benchmark';
}

// Dark-theme verdict colours (status palette).
const VERDICT_COLOR: Record<string, string> = {
  below_market: '#38a574',
  at_market: '#e0a568',
  above_market: '#d9534f',
  insufficient_data: '#8c96a8',
};

export function LeaseDistributionChart({ comps, median, asking, verdict }: Props) {
  const all = [...comps, asking].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (all.length === 0) return <p className="text-sm text-ink-muted">No comparable leases to plot.</p>;

  const sorted = [...comps].sort((a, b) => a - b);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const W = 560, H = 200, padX = 36, padTop = 24, padBottom = 28;
  const plotH = H - padTop - padBottom;
  const n = sorted.length;
  const slot = (W - 2 * padX) / Math.max(1, n + 1); // leave a slot for the asking bar
  const barW = Math.max(6, slot * 0.6);
  const yOf = (v: number) => padTop + plotH * (1 - (v - min * 0.9) / (max * 1.05 - min * 0.9));
  const askColor = VERDICT_COLOR[verdict];

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Base-rent distribution: ${n} comps from ₱${min} to ₱${max}/sqm${asking != null ? `, asking ₱${asking}` : ''}${median != null ? `, median ₱${median}` : ''}.`}>
        {/* baseline */}
        <line x1={padX} y1={padTop + plotH} x2={W - padX} y2={padTop + plotH} stroke="#1d2c4d" strokeWidth={1} />

        {/* comp bars */}
        {sorted.map((c, i) => {
          const cx = padX + slot * (i + 1);
          const y = yOf(c);
          return (
            <g key={i}>
              <rect x={cx - barW / 2} y={y} width={barW} height={padTop + plotH - y} rx={3} fill="#2f4f7a">
                <title>₱{c}/sqm</title>
              </rect>
            </g>
          );
        })}

        {/* median line */}
        {median != null && (
          <>
            <line x1={padX} y1={yOf(median)} x2={W - padX} y2={yOf(median)} stroke="#8c96a8" strokeWidth={1} strokeDasharray="3 3" />
            <text x={W - padX} y={yOf(median) - 4} textAnchor="end" fontSize={10} fill="#8c96a8">median ₱{median}</text>
          </>
        )}

        {/* asking bar (highlighted, verdict-coloured) */}
        {asking != null && (
          <g>
            <rect x={W - padX - barW} y={yOf(asking)} width={barW} height={padTop + plotH - yOf(asking)} rx={3} fill={askColor}>
              <title>Your site ₱{asking}/sqm</title>
            </rect>
            <text x={W - padX - barW / 2} y={yOf(asking) - 6} textAnchor="middle" fontSize={10} fontWeight={700} fill={askColor}>
              ₱{asking}
            </text>
            <text x={W - padX - barW / 2} y={padTop + plotH + 16} textAnchor="middle" fontSize={9} fill="#8c96a8">your site</text>
          </g>
        )}

        {/* min / max labels */}
        <text x={padX} y={padTop + plotH + 16} textAnchor="start" fontSize={9} fill="#8c96a8">₱{min}</text>
        <text x={W - padX - barW - 8} y={padTop + plotH + 16} textAnchor="end" fontSize={9} fill="#8c96a8">₱{max}</text>
      </svg>
      <figcaption className="mt-1 text-center text-xs text-ink-muted">
        Comparable leases (₱/sqm) low→high; your asking rate highlighted; corridor median marked.
      </figcaption>
    </figure>
  );
}
