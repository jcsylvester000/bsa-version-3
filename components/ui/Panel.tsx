/** A titled dark panel — the standard container in the dashboard. */
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
    <section className={`card p-5 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex items-start justify-between">
          <div>
            {title && <h3 className="text-base font-semibold text-ink-text">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-muted">{subtitle}</p>}
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
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-panel-2">
      <div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, score))}%` }} />
    </div>
  );
}
