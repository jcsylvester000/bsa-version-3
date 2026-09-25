/** A titled panel — the standard container. */
export function Panel({
  title,
  subtitle,
  right,
  children,
  className = '',
}: {
  title?: React.ReactNode;
  subtitle?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card p-6 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h3 className="font-body text-title text-ink-text">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-label font-normal text-ink-muted">{subtitle}</p>}
          </div>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** Horizontal score bar 0–100 with a verdict-tinted fill. */
export function ScoreBar({ score, band }: { score: number; band?: 'go' | 'caution' | 'nogo' }) {
  const color = band === 'go' ? 'bg-go' : band === 'nogo' ? 'bg-nogo' : band === 'caution' ? 'bg-caution' : 'bg-accent';
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-panel-2" role="presentation">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
    </div>
  );
}

/** Stacked Truth Layer mix bar (Verified / Assumed / Projected %). */
export function TruthMixBar({ pct }: { pct: { verified: number; assumed: number; projected: number } }) {
  return (
    <div>
      <div className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={`Verified ${pct.verified}%, Assumed ${pct.assumed}%, Projected ${pct.projected}%`}>
        <span className="bg-verified" style={{ width: `${pct.verified}%` }} />
        <span className="bg-assumed" style={{ width: `${pct.assumed}%` }} />
        <span className="bg-projected" style={{ width: `${pct.projected}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-label font-normal text-ink-muted">
        <span><b className="text-verified">✓ {pct.verified}%</b> Verified</span>
        <span><b className="text-assumed">≈ {pct.assumed}%</b> Assumed</span>
        <span><b className="text-projected">↗ {pct.projected}%</b> Projected</span>
      </div>
    </div>
  );
}
