import { TRUTH_META, type TruthLayer } from '@/lib/truth/truthLayer';

/** Truth Layer chip — dark theme. */
export function TruthChip({ layer, title }: { layer: TruthLayer; title?: string }) {
  const meta = TRUTH_META[layer];
  return (
    <span className={`tl-chip tl-${layer}`} title={title ?? meta.meaning}>
      {meta.label}
    </span>
  );
}

/** Verdict pill (go / caution / nogo). */
export function VerdictPill({ verdict }: { verdict: 'go' | 'caution' | 'nogo' | string }) {
  const map: Record<string, { cls: string; label: string }> = {
    go: { cls: 'pill-go', label: 'GO' },
    caution: { cls: 'pill-caution', label: 'CAUTION' },
    nogo: { cls: 'pill-nogo', label: 'NO-GO' },
    adds: { cls: 'pill-go', label: 'ADDS' },
    mixed: { cls: 'pill-caution', label: 'MIXED' },
    redistributes: { cls: 'pill-nogo', label: 'REDISTRIBUTES' },
  };
  const m = map[verdict] ?? { cls: 'pill-caution', label: verdict.toUpperCase() };
  return <span className={`pill ${m.cls}`}>{m.label}</span>;
}

/** "NEW" / feature tag. */
export function NewTag({ children = 'NEW' }: { children?: React.ReactNode }) {
  return <span className="pill pill-new text-[10px]">{children}</span>;
}
