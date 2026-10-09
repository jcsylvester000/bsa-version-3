/**
 * Rent vs. location read (2026-10-09, broker decision): BSA scores lower rent higher — brokers look for
 * the lowest rent first — but a higher-rent site can still be the stronger option when the location
 * reads better. This line puts the two side by side so the broker can decide how much of the client's
 * budget to allocate. Positional only: it never says a rent is expensive, cheap or a good deal.
 * Pure + client-safe (unit-tested).
 */

export type LocationRead = 'strong' | 'mixed' | 'weak';

/** Location strength from the non-rent modules: territory tone + daypart window match. */
export function locationRead(territoryTone: string | null | undefined, daypartWindowPct: number | null | undefined): LocationRead | null {
  const t = territoryTone === 'go' ? 2 : territoryTone === 'caution' ? 1 : territoryTone === 'nogo' ? 0 : null;
  const d = daypartWindowPct == null || !Number.isFinite(daypartWindowPct) ? null : daypartWindowPct >= 60 ? 2 : daypartWindowPct >= 40 ? 1 : 0;
  const parts = [t, d].filter((x): x is number => x != null);
  if (!parts.length) return null;
  if (t === 0) return 'weak'; // a territory deal-breaker outweighs a good daypart
  const avg = parts.reduce((a, b) => a + b, 0) / parts.length;
  return avg >= 1.5 ? 'strong' : avg >= 1 ? 'mixed' : 'weak';
}

/** One neutral line for the Lease module, or null when there is no asking-rent percentile. */
export function leaseTradeoffNote(rentPercentile: number | null | undefined, read: LocationRead | null): string | null {
  if (rentPercentile == null || !Number.isFinite(rentPercentile) || read == null) return null;
  const rent = rentPercentile >= 60 ? 'above' : rentPercentile <= 40 ? 'below' : 'near';
  const loc = read === 'strong' ? 'reads strong on territory and demand timing' : read === 'mixed' ? 'reads mixed on territory and demand timing' : 'reads weak on territory or demand timing';
  const lead = `Rent sits ${rent} the corridor median and the location ${loc}.`;
  if (rent === 'above' && read === 'strong') return `${lead} Lower rent scores higher in BSA, but this site's pull may justify a larger share of the rent budget — the broker and client decide.`;
  if (rent === 'below' && read === 'weak') return `${lead} The rent score is helped by the lower rent; check that the location can carry the format before relying on it.`;
  if (rent === 'below' && read === 'strong') return `${lead} Both the rent position and the location read support this site.`;
  return `${lead} Weigh the rent against the client's budget alongside the other modules.`;
}
