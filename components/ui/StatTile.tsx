import type { TruthLayer } from '@/lib/truth/truthLayer';
import { TruthChip } from '@/components/ui/Chips';

/**
 * KPI stat tile — label, hero value, optional context line and Truth Layer chip.
 * A missing value (null/undefined) renders the honest-gap state: dashed border + "—", never 0.
 */
export function StatTile({
  label,
  value,
  sub,
  accent,
  truth,
}: {
  label: string;
  value: string | number | null | undefined;
  sub?: string;
  accent?: 'go' | 'caution' | 'nogo' | 'accent';
  truth?: TruthLayer;
}) {
  const empty = value == null || value === '—';
  const valueColor = empty
    ? 'text-ink-muted'
    : accent === 'go' ? 'text-go'
    : accent === 'caution' ? 'text-caution'
    : accent === 'nogo' ? 'text-nogo'
    : accent === 'accent' ? 'text-accent-text'
    : 'text-ink-text';
  return (
    <div className={`stat-tile ${empty ? 'stat-empty' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="stat-label">{label}</p>
        {truth && !empty && <TruthChip layer={truth} compact />}
      </div>
      <p className={`stat-value ${valueColor}`}>{empty ? '—' : value}</p>
      {sub && <p className="text-label font-normal text-ink-muted">{sub}</p>}
    </div>
  );
}
