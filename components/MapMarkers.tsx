/**
 * Shared map-marker vocabulary (design v2, PATCHES §4). Shape carries meaning, colour reinforces it:
 *   site     — Muesli teardrop pin      (.mk-site)
 *   outlet   — white ring               (.mk-outlet)
 *   direct   — red diamond              (.mk-direct)
 *   adjacent — amber square             (.mk-adjacent)
 *   other    — small grey dot           (.mk-other, context only)
 * The recipes live in app/globals.css. Used by TerritoryMap, GapsMap and LocationPicker.
 */
export type MarkerKind = 'site' | 'outlet' | 'direct' | 'adjacent' | 'other';

/**
 * Build a MapLibre marker element. MapLibre writes its own `transform` onto the element it
 * positions, so the styled shape (which may rotate) is a CHILD of a plain wrapper.
 */
export function markerElement(kind: MarkerKind, label?: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.style.cursor = 'pointer';
  if (label) wrap.setAttribute('aria-label', label);
  const shape = document.createElement('div');
  shape.className = `mk-${kind}`;
  wrap.appendChild(shape);
  return wrap;
}

/** `area` = the numbered White-Space recommendation pin (GapsMap). */
export type LegendKind = MarkerKind | 'area';

/** Legend overlay, bottom-left of the map. Callers pass only kinds that are actually on the map. */
export function MapLegend({ items }: { items: Array<{ kind: LegendKind; text: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-3.5 left-3.5 z-10 rounded-control border border-ink-border-strong bg-ink-panel/95 px-3.5 py-2.5 text-[13px] text-ink-text">
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li key={it.kind + it.text} className="flex items-center gap-2.5">
            {/* The .mk-* recipes own `transform` (rotation), so scale on a wrapper, not the shape. */}
            <span className="grid h-6 w-6 shrink-0 place-items-center" aria-hidden>
              {it.kind === 'area' ? (
                <span className="grid h-5 w-5 place-items-center rounded-full border-2 border-midnight bg-muesli text-[10px] font-extrabold text-midnight">1</span>
              ) : (
                <span className="grid place-items-center" style={{ transform: 'scale(0.6)' }}>
                  <span className={`mk-${it.kind}`} />
                </span>
              )}
            </span>
            {it.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Screen-reader list of what the map shows — maps are not otherwise accessible. */
export function SrMarkerList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="sr-only">
      <p>{title}</p>
      <ul>
        {items.map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}
