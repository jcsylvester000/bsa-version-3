/**
 * Analysis context assembler — deterministic, pure, no AI, no server imports.
 *
 * Folds the four persisted module_result payloads + intake + site + composite into the
 * STRICT JSON contract the Analysis AI reads (see the Knowledge Base §1). This is the ONLY
 * data the model ever sees; nothing here computes a new figure — it only selects and shapes
 * the already-computed values, each carrying its Truth Layer. Kept pure so it is unit-tested.
 */

export type TruthLayer = 'verified' | 'assumed' | 'projected';

/** Loose shapes for the persisted payloads (module_result.payload JSON). */
type AnyRec = Record<string, unknown> | null | undefined;

export interface AnalysisModuleInput {
  payload: AnyRec;
  isPrimary: boolean;
  truthLayer: TruthLayer;
}

export interface AnalysisInput {
  meta: {
    runId: string;
    siteId: string;
    siteLabel: string;
    city: string | null;
    barangay: string | null;
    siteType: string | null;
    brand: string | null;
    vertical: string | null;
    conceptLabel: string | null;
    overallConfidence: string;
    generatedAt: string;
  };
  /** The intake sections the operator actually submitted (already merged, PII-free). */
  intake: Record<string, unknown>;
  composite: { score: number | null; verdict: string | null };
  modules: {
    territory?: AnalysisModuleInput | null;
    lease?: AnalysisModuleInput | null;
    daypart?: AnalysisModuleInput | null;
    whitespace?: AnalysisModuleInput | null;
  };
}

/* ---- small pickers (never invent; just read what's there) ---------------- */
const g = (o: AnyRec, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface AnalysisContext {
  meta: AnalysisInput['meta'];
  intake: Record<string, unknown>;
  composite: { score: number | null; verdict: string | null };
  modules: {
    territory: Record<string, unknown> & { ran: boolean };
    lease: Record<string, unknown> & { ran: boolean };
    daypart: Record<string, unknown> & { ran: boolean };
    whitespace: Record<string, unknown> & { ran: boolean };
  };
  truthLayerSummary: { verified: number; assumed: number; projected: number };
  flags: string[];
  guardrails: { brokerSupplementation: true; noPriceVerdict: true; zonalIsTaxFloor: true };
}

function territoryBlock(m?: AnalysisModuleInput | null) {
  if (!m || !m.payload) return { ran: false as const, isPrimary: m?.isPrimary ?? true, truthLayer: m?.truthLayer ?? 'projected' };
  const p = m.payload;
  const mix = g(p, 'competitorMix') as AnyRec;
  const cset = g(p, 'competitorSet') as AnyRec;
  return {
    ran: true as const,
    isPrimary: m.isPrimary,
    truthLayer: m.truthLayer,
    verdict: str(g(p, 'verdict')),
    maxOverlapPct: num(g(p, 'maxOverlapPct')),
    headlineSource: str(g(p, 'headlineSource')),
    ownOutletOverlapPct: num(g(p, 'ownOutletOverlapPct')),
    competitiveSaturationPct: num(g(p, 'competitiveSaturationPct')),
    competitorCount: num(g(p, 'competitorCount')),
    competitorMix: mix ? { direct: num(g(mix, 'direct')), adjacent: num(g(mix, 'adjacent')), unrelated: num(g(mix, 'unrelated')) } : null,
    totalCannibalizedPhp: num(g(p, 'totalCannibalizedPhp')),
    competitorSet: cset ? { anchorBrand: str(g(cset, 'anchorBrand')), competitors: arr(g(cset, 'competitors')).slice(0, 8), truthLayer: str(g(cset, 'truthLayer')) } : null,
    affectedOutletCount: arr(g(p, 'affectedOutlets')).length,
    flags: arr(g(p, 'flags')),
  };
}

function leaseBlock(m?: AnalysisModuleInput | null) {
  if (!m || !m.payload) return { ran: false as const, isPrimary: m?.isPrimary ?? true, truthLayer: m?.truthLayer ?? 'assumed' };
  const p = m.payload;
  const z = g(p, 'zonal') as AnyRec;
  const band = z ? (g(z, 'band') as AnyRec) : null;
  const cc = z ? (g(z, 'crossCheck') as AnyRec) : null;
  const ind = z ? (g(z, 'indicativeRent') as AnyRec) : null;
  return {
    ran: true as const,
    isPrimary: m.isPrimary,
    truthLayer: m.truthLayer,
    verdict: str(g(p, 'verdict')),
    corridor: str(g(p, 'corridor')),
    sampleSize: num(g(p, 'sampleSize')),
    baseRentPercentile: num(g(p, 'baseRentPercentile')),
    negotiatingRoomPhpSqm: num(g(p, 'negotiatingRoomPhpSqm')),
    negotiatingRoomPct: num(g(p, 'negotiatingRoomPct')),
    lowSample: g(p, 'lowSample') === true,
    zonal: z
      ? {
          band: band ? { classification: str(g(band, 'classification')), lowPhpSqm: num(g(band, 'lowPhpSqm')), highPhpSqm: num(g(band, 'highPhpSqm')), midPhpSqm: num(g(band, 'midPhpSqm')), grain: str(g(band, 'grain')), truthLayer: str(g(band, 'truthLayer')) } : null,
          crossCheck: cc ? { rentPer1000: num(g(cc, 'rentPer1000')), position: str(g(cc, 'position')) } : null,
          indicativeRent: ind ? { lowPhpSqm: num(g(ind, 'lowPhpSqm')), highPhpSqm: num(g(ind, 'highPhpSqm')) } : null,
          usedAsFallback: g(z, 'usedAsFallback') === true,
        }
      : null,
    flags: arr(g(p, 'flags')),
  };
}

function daypartBlock(m?: AnalysisModuleInput | null) {
  if (!m || !m.payload) return { ran: false as const, isPrimary: m?.isPrimary ?? false, truthLayer: m?.truthLayer ?? 'projected' };
  const p = m.payload;
  const s = g(p, 'seasonality') as AnyRec;
  const peak = s ? (g(s, 'peakSeason') as AnyRec) : null;
  const trough = s ? (g(s, 'troughSeason') as AnyRec) : null;
  return {
    ran: true as const,
    isPrimary: m.isPrimary,
    truthLayer: m.truthLayer,
    verdict: str(g(p, 'verdict')),
    windowMatchPct: num(g(p, 'windowMatchPct')),
    daytimeShare: num(g(p, 'daytimeShare')),
    peakHour: num(g(p, 'peakHour')),
    noCatchmentData: g(p, 'noCatchmentData') === true,
    seasonality: s
      ? {
          peakSeason: peak ? str(g(peak, 'label')) : null,
          troughSeason: trough ? str(g(trough, 'label')) : null,
          termTimeNote: str(g(s, 'termTimeNote')),
        }
      : null,
  };
}

function whitespaceBlock(m?: AnalysisModuleInput | null) {
  if (!m || !m.payload) return { ran: false as const, isPrimary: m?.isPrimary ?? true, truthLayer: m?.truthLayer ?? 'projected' };
  const p = m.payload;
  const proposed = g(p, 'proposed') as AnyRec;
  const recs = arr(g(p, 'recommendations')).slice(0, 5).map((r) => {
    const rr = r as AnyRec;
    return {
      barangay: str(g(rr, 'barangay')),
      city: str(g(rr, 'city')),
      cannibalizationPct: num(g(rr, 'cannibalizationPct')),
      verdict: str(g(rr, 'verdict')),
      beatsProposed: g(rr, 'beatsProposed') === true ? true : g(rr, 'beatsProposed') === false ? false : null,
    };
  });
  return {
    ran: true as const,
    isPrimary: m.isPrimary,
    truthLayer: m.truthLayer,
    scanned: num(g(p, 'scanned')),
    threshold: num(g(p, 'threshold')),
    source: str(g(p, 'source')),
    proposed: proposed ? { label: str(g(proposed, 'label')), cannibalizationPct: num(g(proposed, 'cannibalizationPct')) } : null,
    recommendations: recs,
  };
}

/** Build the strict Analysis JSON object from the loaded inputs. Deterministic. */
export function buildAnalysisContext(input: AnalysisInput): AnalysisContext {
  const territory = territoryBlock(input.modules.territory);
  const lease = leaseBlock(input.modules.lease);
  const daypart = daypartBlock(input.modules.daypart);
  const whitespace = whitespaceBlock(input.modules.whitespace);

  // Truth-layer summary across the modules that ran.
  const layers: TruthLayer[] = [input.modules.territory, input.modules.lease, input.modules.daypart, input.modules.whitespace]
    .filter((m): m is AnalysisModuleInput => !!m && !!m.payload)
    .map((m) => m.truthLayer);
  const truthLayerSummary = {
    verified: layers.filter((l) => l === 'verified').length,
    assumed: layers.filter((l) => l === 'assumed').length,
    projected: layers.filter((l) => l === 'projected').length,
  };

  // Aggregate module flags (dedup).
  const flags = Array.from(new Set([
    ...arr((territory as AnyRec)?.['flags']).map(String),
    ...arr((lease as AnyRec)?.['flags']).map(String),
  ].filter(Boolean)));

  return {
    meta: input.meta,
    intake: input.intake,
    composite: input.composite,
    modules: { territory, lease, daypart, whitespace },
    truthLayerSummary,
    flags,
    guardrails: { brokerSupplementation: true, noPriceVerdict: true, zonalIsTaxFloor: true },
  };
}

/** Pretty strict JSON text — this is what is handed to the model as `context`. */
export function analysisContextToJsonText(ctx: AnalysisContext): string {
  return JSON.stringify(ctx, null, 2);
}
