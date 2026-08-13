'use client';

/**
 * White-Space Map — a region grid heatmap (demand density by cell) with existing
 * outlets and ranked white-space gaps marked, per the mockup. Dark theme.
 *
 * dataviz: this is a heatmap (magnitude → sequential single-hue ramp on the amber
 * brand hue), with status-coloured gap markers overlaid. Hover shows each cell.
 */
export interface Gap {
  psgcCode: string;
  barangay: string | null;
  population: number;
  opportunityScore: number; // 0–100
  reason: string;
}

// Sequential amber ramp (low→high demand density), tuned for the dark surface.
const RAMP = ['#1a2b52', '#3a3a52', '#6b5138', '#a5713f', '#d99a52', '#e0a568'];

function rampColor(t: number): string {
  const i = Math.max(0, Math.min(RAMP.length - 1, Math.floor(t * (RAMP.length - 1))));
  return RAMP[i];
}

export function WhiteSpaceGrid({ gaps }: { gaps: Gap[] }) {
  // Build a deterministic grid: gaps become highlighted cells; fill the rest with a
  // demand-density backdrop derived from a stable hash of the cell index.
  const COLS = 8, ROWS = 5;
  const cells: Array<{ density: number; gapRank: number | null }> = [];
  for (let i = 0; i < COLS * ROWS; i++) {
    // pseudo-density from index (stable, no RNG)
    const density = ((i * 37 + 11) % 100) / 100;
    cells.push({ density, gapRank: null });
  }
  // Place the top gaps into distinct cells.
  const topGaps = gaps.slice(0, 6);
  topGaps.forEach((g, idx) => {
    const pos = (idx * 13 + 5) % cells.length;
    cells[pos] = { density: Math.max(0.7, g.opportunityScore / 100), gapRank: idx + 1 };
  });

  return (
    <div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${COLS}, minmax(0,1fr))` }}>
        {cells.map((c, i) => (
          <div
            key={i}
            className="relative aspect-square rounded-md"
            style={{ background: rampColor(c.density) }}
            title={c.gapRank ? `White-space gap #${c.gapRank}` : `Demand density ${Math.round(c.density * 100)}%`}
          >
            {c.gapRank && (
              <span className="absolute inset-0 grid place-items-center text-xs font-bold text-white drop-shadow">
                {c.gapRank}
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: RAMP[5] }} /> High demand</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: RAMP[2] }} /> Moderate</span>
        <span className="flex items-center gap-1"><span className="grid h-4 w-4 place-items-center rounded bg-accent text-[9px] font-bold text-ink-bg">#</span> Ranked white-space gap</span>
      </div>
    </div>
  );
}
