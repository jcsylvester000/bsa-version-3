import { TRUTH_META, type TruthLayer } from '@/lib/truth/truthLayer';

/**
 * The single UI element for showing a Truth Layer classification. Used wherever a
 * value appears so the classification is never stripped between data and display.
 */
export function TruthChip({ layer, title }: { layer: TruthLayer; title?: string }) {
  const meta = TRUTH_META[layer];
  return (
    <span className={`tl-chip tl-${layer}`} title={title ?? meta.meaning}>
      {meta.label}
    </span>
  );
}
