/**
 * R-07 — traffic-corridor row validation/normalisation. Pure + client-safe (unit-tested).
 *
 * A traffic-corridor row is corridor-keyed and carries a base AADT band plus a `seasonal` map of
 * low/high multipliers (Christmas peak, Undas, Holy Week, payday, school-open …). The base band /
 * AADT is the empirical part (owner-supplied from DPWH ATTAS counts, Verified/Assumed); the
 * seasonal multipliers are a documented MODEL (Projected) — a modelled range, never a live count.
 *
 * This normaliser is shared by the JSON loader and the tests. It keeps a row only when it has a
 * corridor name and a non-empty seasonal map (never fabricates a seasonal shape for a bare row).
 */
export type Band = 'very_high' | 'high' | 'medium' | 'low';
export type Truth = 'verified' | 'assumed' | 'projected';

export interface SeasonalPhase { low: number; high: number; truthLayer?: Truth; label?: string }
export interface TrafficRow {
  corridor: string;
  baseBand: Band;
  aadtRef: number | null;
  seasonal: Record<string, SeasonalPhase>;
  truthLayer: Truth;
  notes: string | null;
  source: string | null;
}

export function asBand(v: unknown): Band {
  const t = String(v ?? '').trim().toLowerCase();
  if (t === 'very_high' || t === 'high' || t === 'low') return t;
  return 'medium';
}

export function asTruth(v: unknown): Truth {
  const t = String(v ?? '').trim().toLowerCase();
  return t === 'verified' || t === 'projected' ? t : 'assumed';
}

type Rec = Record<string, unknown>;

/** Normalise one raw traffic-corridor record. Null when it has no corridor or no seasonal map. */
export function trafficRowFrom(rec: Rec): TrafficRow | null {
  const corridor = String(rec.corridor ?? '').trim();
  const seasonalRaw = rec.seasonal;
  if (!corridor || !seasonalRaw || typeof seasonalRaw !== 'object') return null;

  const seasonal: Record<string, SeasonalPhase> = {};
  for (const [phase, val] of Object.entries(seasonalRaw as Record<string, unknown>)) {
    if (!val || typeof val !== 'object') continue;
    const v = val as Record<string, unknown>;
    const low = Number(v.low);
    const high = Number(v.high);
    if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
    seasonal[phase] = {
      low, high,
      truthLayer: v.truthLayer ? asTruth(v.truthLayer) : 'projected',
      label: v.label != null ? String(v.label) : undefined,
    };
  }
  if (Object.keys(seasonal).length === 0) return null;

  const aadt = rec.aadtRef == null || rec.aadtRef === '' ? null : Number(rec.aadtRef);
  return {
    corridor,
    baseBand: asBand(rec.baseBand),
    aadtRef: Number.isFinite(aadt as number) ? (aadt as number) : null,
    seasonal,
    truthLayer: asTruth(rec.truthLayer),
    notes: rec.notes != null ? String(rec.notes) : null,
    source: rec.source != null ? String(rec.source) : null,
  };
}
