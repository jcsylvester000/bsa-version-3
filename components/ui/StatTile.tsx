/**
 * KPI stat tile for the Site Intelligence Dashboard — a hero number with a label
 * and an optional sub-line. Matches the mockup's tile row.
 */
export function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: 'go' | 'caution' | 'nogo' | 'accent';
}) {
  const valueColor =
    accent === 'go' ? 'text-go'
    : accent === 'caution' ? 'text-caution'
    : accent === 'nogo' ? 'text-nogo'
    : accent === 'accent' ? 'text-accent'
    : 'text-ink-text';
  return (
    <div className="stat-tile">
      <p className="stat-label">{label}</p>
      <p className={`stat-value ${valueColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}
