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

/* ---- Text schema (the AI reads this) ------------------------------------- */
// A labeled, human-readable serialization of the AnalysisContext that mirrors the on-screen
// Analysis page 1:1 — every row the operator sees, with its Truth Layer. This is the "schema
// as text" the model reads and turns into prose. Because the page and the model both derive
// from the same AnalysisContext, they can never disagree.

const rd = (o: AnyRec, k: string): unknown => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);
const peso = (n: number | null): string => (n == null ? '—' : `PHP ${Math.round(n).toLocaleString()}`);
const pct = (n: number | null): string => (n == null ? '—' : `${n}%`);
const T = (l: string | null | undefined): string => (l === 'verified' ? 'Verified' : l === 'assumed' ? 'Assumed' : l === 'projected' ? 'Projected' : 'Projected');

function line(label: string, value: string, truth?: string): string {
  return `- ${label}: ${value}${truth ? ` (${truth})` : ''}`;
}

export function analysisSchemaText(ctx: AnalysisContext): string {
  const m = ctx.meta;
  const t = ctx.modules.territory as AnyRec & { ran?: boolean };
  const l = ctx.modules.lease as AnyRec & { ran?: boolean };
  const d = ctx.modules.daypart as AnyRec & { ran?: boolean };
  const w = ctx.modules.whitespace as AnyRec & { ran?: boolean };
  const ran = [t, l, d, w].filter((x) => x?.ran).length;

  const out: string[] = [];
  out.push('SITE ANALYSIS SCHEMA');
  out.push(
    `Site: ${m.siteLabel}` +
      [m.brand, m.city, m.conceptLabel ?? m.vertical].filter(Boolean).map((x) => ` · ${x}`).join('') +
      ` · ${ran} of 4 modules present`,
  );
  if (ctx.composite.verdict || ctx.composite.score != null) {
    out.push(`Composite: ${ctx.composite.verdict ?? '—'}${ctx.composite.score != null ? ` (score ${ctx.composite.score})` : ''}`);
  }
  out.push(`Overall confidence: ${m.overallConfidence}`);
  out.push(`Truth Layer mix: ${ctx.truthLayerSummary.verified} Verified · ${ctx.truthLayerSummary.assumed} Assumed · ${ctx.truthLayerSummary.projected} Projected`);
  out.push('');

  // Territory Guard
  out.push('[TERRITORY GUARD]' + (t?.ran ? '' : '  (not run for this site)'));
  if (t?.ran) {
    out.push(`verdict: ${verdictLabel('territory', rd(t, 'verdict') as string)}`);
    if (rd(t, 'headlineSource') === 'competitive') out.push('note: driven by competitive saturation, not own branches');
    out.push(line('Own-branch overlap', pct((num(rd(t, 'ownOutletOverlapPct')) ?? num(rd(t, 'maxOverlapPct'))) ?? 0), 'Verified'));
    const mix = rd(t, 'competitorMix') as AnyRec;
    out.push(line('Competitive saturation', `${pct(num(rd(t, 'competitiveSaturationPct')) ?? 0)}${mix ? ` — ${num(rd(mix, 'direct')) ?? 0} direct + ${num(rd(mix, 'adjacent')) ?? 0} adjacent` : ''}`, 'Projected'));
    out.push(line('Est. monthly cannibalization', peso(num(rd(t, 'totalCannibalizedPhp')) ?? 0), 'Projected'));
    const cset = rd(t, 'competitorSet') as AnyRec;
    const comps = cset ? (arr(rd(cset, 'competitors')).map(String)) : [];
    if (comps.length) out.push(line('Competes with', comps.slice(0, 5).join(', ')));
    const affected = num(rd(t, 'affectedOutletCount')) ?? 0;
    out.push(line('Affected own outlets', affected === 0 ? 'None in this catchment' : String(affected), 'Verified'));
  }
  out.push('');

  // Lease Benchmark
  out.push('[LEASE BENCHMARK]' + (l?.ran ? '' : '  (not run for this site)'));
  if (l?.ran) {
    out.push(`verdict: ${verdictLabel('lease', rd(l, 'verdict') as string)}`);
    out.push(line('Corridor', str(rd(l, 'corridor')) ?? '—'));
    out.push(line('Comparable leases', String(num(rd(l, 'sampleSize')) ?? 0), 'Verified'));
    const perc = num(rd(l, 'baseRentPercentile'));
    out.push(line('Base-rent percentile', perc != null ? ordinalText(perc) : '—', 'Assumed'));
    const nrm = num(rd(l, 'negotiatingRoomPhpSqm'));
    if (nrm != null) out.push(line('Negotiating room to median', `${peso(Math.abs(nrm))}/sqm${num(rd(l, 'negotiatingRoomPct')) != null ? ` (${Math.abs(num(rd(l, 'negotiatingRoomPct'))!)}% ${nrm > 0 ? 'above' : 'below'})` : ''}`, 'Assumed'));
    const z = rd(l, 'zonal') as AnyRec;
    const band = z ? (rd(z, 'band') as AnyRec) : null;
    if (band) {
      out.push(line('BIR zonal band', `${str(rd(band, 'classification')) ?? 'CR'} · ${peso(num(rd(band, 'lowPhpSqm')))}–${peso(num(rd(band, 'highPhpSqm')))}/sqm${rd(z!, 'usedAsFallback') === true ? ' · used as fallback anchor' : ''}`, 'Verified'));
    }
  }
  out.push('');

  // Daypart Demand
  out.push('[DAYPART DEMAND]' + (d?.ran ? '' : '  (not run for this site)'));
  if (d?.ran) {
    const noData = rd(d, 'noCatchmentData') === true;
    const win = num(rd(d, 'windowMatchPct')) ?? 0;
    out.push(`verdict: ${noData ? 'Catchment mix not derived' : win >= 60 ? 'Strong window match' : win >= 40 ? 'Partial window match' : 'Weak window match'}`);
    out.push(line('Peak-hour demand captured', pct(win), 'Projected'));
    const share = num(rd(d, 'daytimeShare'));
    out.push(line('Catchment mix', noData || share == null ? 'Not derived (demographic layer not loaded)' : `${Math.round(share * 10) / 10}% daytime · ${Math.round((100 - share) * 10) / 10}% residential`, 'Projected'));
    if (!noData && share != null) out.push(line('Peak window', share >= 50 ? '11:00–14:00 (office-led)' : '17:00–20:00 (residential)', 'Projected'));
    const seas = rd(d, 'seasonality') as AnyRec;
    if (seas && str(rd(seas, 'peakSeason'))) out.push(line('Seasonal peak', str(rd(seas, 'peakSeason'))!, 'Projected'));
    if (seas && str(rd(seas, 'troughSeason'))) out.push(line('Seasonal trough', str(rd(seas, 'troughSeason'))!, 'Projected'));
  }
  out.push('');

  // White-Space
  out.push('[WHITE-SPACE]' + (w?.ran ? '' : '  (not run for this site)'));
  if (w?.ran) {
    const recs = arr(rd(w, 'recommendations')) as AnyRec[];
    out.push(`verdict: ${recs.length ? `${recs.length} recommended area(s)` : 'No open areas in current coverage'}`);
    out.push(line('Barangays scanned', String(num(rd(w, 'scanned')) ?? 0), 'Verified'));
    out.push(line('Cannibalization threshold', `<= ${num(rd(w, 'threshold')) ?? 40}`, 'Projected'));
    const prop = rd(w, 'proposed') as AnyRec;
    if (prop && num(rd(prop, 'cannibalizationPct')) != null) out.push(line("This site's cannibalization", `${Math.round(num(rd(prop, 'cannibalizationPct'))!)}%`, 'Projected'));
    recs.slice(0, 3).forEach((r, i) => {
      const name = [str(rd(r, 'barangay')) ?? 'Unnamed area', str(rd(r, 'city'))].filter(Boolean).join(', ');
      out.push(line(`Alternative #${i + 1} ${name}`, `${Math.round(num(rd(r, 'cannibalizationPct')) ?? 0)}% cannibalization${rd(r, 'beatsProposed') === true ? ' — beats this site' : ''}`, 'Projected'));
    });
  }
  out.push('');

  if (ctx.flags.length) out.push(`FLAGS: ${ctx.flags.join(', ')}`);
  out.push('GUARDRAILS: broker-supplementation; no price verdict; BIR zonal is a tax-reference floor only.');

  return out.join('\n');
}

/** Verdict → human label, matching the on-screen chips. */
function verdictLabel(module: 'territory' | 'lease', v: string | null | undefined): string {
  if (module === 'territory') {
    return v === 'adds' ? 'Adds sales' : v === 'redistributes' ? 'Redistributes existing sales' : 'Mixed — some redistribution';
  }
  return v === 'below_market' ? 'Below market — favourable'
    : v === 'above_market' ? 'Above market — likely overpaying'
    : v === 'at_market' ? 'At market'
    : v === 'corridor_benchmark' ? 'Corridor market benchmark'
    : 'Insufficient comparable data';
}

function ordinalText(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]) + ' percentile';
}
