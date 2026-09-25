import { TRUTH_META, type TruthLayer } from '@/lib/truth/truthLayer';

const TRUTH_GLYPH: Record<TruthLayer, string> = { verified: '✓', assumed: '≈', projected: '↗' };

/**
 * Truth Layer chip — outlined tag with glyph + word. `compact` renders the glyph only
 * (tables, report rows) with an sr-only label and tooltip; the page legend explains the glyphs.
 */
export function TruthChip({ layer, title, compact = false }: { layer: TruthLayer; title?: string; compact?: boolean }) {
  const meta = TRUTH_META[layer];
  if (compact) {
    return (
      <span className={`tl-chip tl-chip-sm tl-${layer}`} title={title ?? `${meta.label} — ${meta.meaning}`}>
        <span aria-hidden>{TRUTH_GLYPH[layer]}</span>
        <span className="sr-only">{meta.label}</span>
      </span>
    );
  }
  return (
    <span className={`tl-chip tl-${layer}`} title={title ?? meta.meaning}>
      <span aria-hidden>{TRUTH_GLYPH[layer]}</span>
      {meta.label}
    </span>
  );
}

/** One-line legend — place once per page header (not inside every tab). */
export function TruthLegend({ className = '' }: { className?: string }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 text-label font-normal text-ink-muted ${className}`}>
      <span>Truth Layer:</span>
      {(['verified', 'assumed', 'projected'] as TruthLayer[]).map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5" title={TRUTH_META[l].meaning}>
          <TruthChip layer={l} compact />
          {TRUTH_META[l].label}
        </span>
      ))}
    </div>
  );
}

type VerdictKey = 'go' | 'caution' | 'nogo';
const VERDICT: Record<string, { key: VerdictKey; label: string; icon: string }> = {
  go: { key: 'go', label: 'Proceed', icon: '✓' },
  caution: { key: 'caution', label: 'Caution', icon: '▲' },
  nogo: { key: 'nogo', label: 'No-Go', icon: '✕' },
  adds: { key: 'go', label: 'Adds sales', icon: '✓' },
  mixed: { key: 'caution', label: 'Mixed', icon: '▲' },
  redistributes: { key: 'nogo', label: 'Redistributes', icon: '✕' },
};
export const VERDICT_ICON: Record<VerdictKey, string> = { go: '✓', caution: '▲', nogo: '✕' };

/** Verdict pill — solid fill, circled icon, word. Never colour alone. */
export function VerdictPill({ verdict, label }: { verdict: VerdictKey | 'adds' | 'mixed' | 'redistributes' | string | null | undefined; label?: string }) {
  if (!verdict) return <span className="pill pill-empty">— Not enough data</span>;
  const m = VERDICT[verdict] ?? { key: 'caution' as VerdictKey, label: String(verdict), icon: '▲' };
  return (
    <span className={`pill pill-${m.key}`}>
      <span className="pill-icon" aria-hidden>{m.icon}</span>
      {label ?? m.label}
    </span>
  );
}

/** Inline status (findings, module headers): coloured icon + word, no fill. */
export function StatusText({ tone, children }: { tone: VerdictKey | 'muted'; children: React.ReactNode }) {
  const cls = tone === 'go' ? 'text-go' : tone === 'nogo' ? 'text-nogo' : tone === 'caution' ? 'text-caution' : 'text-ink-muted';
  const icon = tone === 'muted' ? '—' : VERDICT_ICON[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${cls}`}>
      <span aria-hidden>{icon}</span>
      {children}
    </span>
  );
}

/** "NEW" / feature tag — outlined, Burly Wood, so it never reads as a verdict. */
export function NewTag({ children = 'NEW' }: { children?: React.ReactNode }) {
  return <span className="pill pill-new">{children}</span>;
}
