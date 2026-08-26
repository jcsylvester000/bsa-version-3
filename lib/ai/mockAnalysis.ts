/**
 * Mock analysis narrative — the stand-in for the real model while we validate the shape.
 *
 * It reads the SAME AnalysisContext the page and the (future) real model read, and composes a
 * natural, decision-useful 1–2 paragraph report from THIS site's real figures — no invented
 * numbers, Truth Layer preserved. Deterministic (no Date.now/random) so a re-run is stable.
 *
 * When the real model drops in (AI_PROVIDER=anthropic), the generator calls it with the same
 * text schema + prompts instead of this composer; nothing else changes. Marked model
 * 'mock-analysis-v1' so it is never mistaken for a live generation.
 */
import type { AnalysisContext } from '@/lib/modules/analysisContext';

type Rec = Record<string, unknown>;
const rd = (o: unknown, k: string): unknown => (o && typeof o === 'object' ? (o as Rec)[k] : undefined);
const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const peso = (v: number | null): string => (v == null ? '—' : `₱${Math.round(v).toLocaleString()}`);

/** Compose the mock Analysis Report from the structured context. Returns 1–2 short paragraphs. */
export function composeMockAnalysis(ctx: AnalysisContext): string {
  const t = ctx.modules.territory as Rec & { ran?: boolean };
  const l = ctx.modules.lease as Rec & { ran?: boolean };
  const d = ctx.modules.daypart as Rec & { ran?: boolean };
  const w = ctx.modules.whitespace as Rec & { ran?: boolean };
  const site = ctx.meta.siteLabel;
  const brand = ctx.meta.brand;
  const concept = ctx.meta.conceptLabel ?? ctx.meta.vertical ?? 'this format';

  const p1: string[] = [];

  // Opening — composite if present, otherwise territory sets the headline.
  const subject = brand ? `${brand} at ${site}` : site;
  if (ctx.composite.verdict) {
    p1.push(`${subject} lands a ${lc(ctx.composite.verdict)} read${ctx.composite.score != null ? ` (composite ${ctx.composite.score})` : ''}.`);
  }

  // Territory Guard — usually the dominant driver.
  if (t?.ran) {
    const verdict = s(rd(t, 'verdict'));
    const sat = n(rd(t, 'competitiveSaturationPct'));
    const mix = rd(t, 'competitorMix') as Rec | null;
    const own = n(rd(t, 'ownOutletOverlapPct')) ?? n(rd(t, 'maxOverlapPct')) ?? 0;
    const competitive = rd(t, 'headlineSource') === 'competitive';
    if (verdict === 'redistributes') {
      p1.push(
        `Territory Guard reads it as redistributing existing sales rather than adding fresh demand${competitive ? ', driven by competitive saturation rather than your own branches' : ''}.`,
      );
    } else if (verdict === 'adds') {
      p1.push('Territory Guard reads the catchment as largely fresh — the site adds demand rather than cannibalizing it.');
    } else {
      p1.push('Territory Guard reads a mixed catchment — part fresh demand, part redistribution.');
    }
    if (sat != null) {
      p1.push(
        `Competitive saturation sits at ${sat}%${mix ? ` (${n(rd(mix, 'direct')) ?? 0} direct and ${n(rd(mix, 'adjacent')) ?? 0} adjacent ${concept.toLowerCase()} inside the catchment)` : ''}, while own-branch overlap is ${own}% — both modelled, with the overlap Verified from coordinates.`,
      );
    }
  }

  // Lease Benchmark — the cost side.
  if (l?.ran) {
    const lv = s(rd(l, 'verdict'));
    const corridor = s(rd(l, 'corridor'));
    const z = rd(l, 'zonal') as Rec | null;
    const band = z ? (rd(z, 'band') as Rec | null) : null;
    const parts: string[] = [];
    parts.push(
      lv === 'above_market' ? `On cost, the asking rent reads above the ${corridor ?? 'corridor'} market` :
      lv === 'below_market' ? `On cost, the asking rent reads below the ${corridor ?? 'corridor'} market — favourable` :
      lv === 'corridor_benchmark' ? `On cost, the ${corridor ?? 'corridor'} benchmark is in place; enter an asking rent to see where it lands` :
      lv === 'at_market' ? `On cost, the asking rent sits at the ${corridor ?? 'corridor'} market` :
      `On cost, comparable leases in ${corridor ?? 'the corridor'} are thin, so treat any range as indicative`,
    );
    if (band) {
      parts.push(
        `the BIR zonal band (${s(rd(band, 'classification')) ?? 'CR'}, ${peso(n(rd(band, 'lowPhpSqm')))}–${peso(n(rd(band, 'highPhpSqm')))}/sqm) is a Verified tax-reference floor, not a price to pay`,
      );
    }
    p1.push(parts.join('; ') + '.');
  }

  const p2: string[] = [];

  // Main tension / risk.
  const risks: string[] = [];
  if (t?.ran && s(rd(t, 'verdict')) === 'redistributes') risks.push('the corridor is already crowded for this concept');
  if (l?.ran && (s(rd(l, 'verdict')) === 'insufficient_data' || rd(l, 'lowSample') === true)) risks.push('the lease read rests on a thin comp sample');
  if (d?.ran && n(rd(d, 'windowMatchPct')) != null && (n(rd(d, 'windowMatchPct')) as number) < 40) risks.push('the daypart window fit is soft');
  if (risks.length) {
    p2.push(`The main tension is that ${risks.join(', and ')}.`);
  }

  // Daypart, only if it is a primary read.
  if (d?.ran && rd(d, 'isPrimary') === true && rd(d, 'noCatchmentData') !== true) {
    const win = n(rd(d, 'windowMatchPct'));
    if (win != null) p2.push(`Demand timing is ${win >= 60 ? 'a strength' : win >= 40 ? 'workable' : 'a weak point'} — ${win}% of modelled demand falls in the format's window (Projected).`);
  }

  // White-Space alternatives.
  if (w?.ran) {
    const recs = list(rd(w, 'recommendations')) as Rec[];
    const prop = rd(w, 'proposed') as Rec | null;
    const propCannib = prop ? n(rd(prop, 'cannibalizationPct')) : null;
    const better = recs.filter((r) => rd(r, 'beatsProposed') === true).slice(0, 2);
    if (better.length) {
      const named = better.map((r) => {
        const name = [s(rd(r, 'barangay')) ?? 'an unnamed area', s(rd(r, 'city'))].filter(Boolean).join(', ');
        return `${name} (${Math.round(n(rd(r, 'cannibalizationPct')) ?? 0)}%)`;
      });
      p2.push(
        `White-Space surfaces lower-overlap alternatives the operator did not propose — ${named.join(' and ')}${propCannib != null ? `, against ${Math.round(propCannib)}% at this site` : ''} — worth weighing before committing.`,
      );
    } else if (recs.length === 0) {
      p2.push('White-Space found no lower-cannibalization area in current coverage, which is itself a signal that the network is saturated for this concept here.');
    }
  }

  // Close — confidence + the one thing to verify on the ground.
  const verify = pickVerifyItem(ctx);
  p2.push(`Overall confidence is ${lc(ctx.meta.overallConfidence)}${verify ? `; before deciding, verify ${verify} on the ground` : ''}. BSA sharpens the read — the broker still validates and closes the deal.`);

  const paras = [p1.join(' ').trim(), p2.join(' ').trim()].filter(Boolean);
  return paras.join('\n\n');
}

/** Choose the single most useful on-ground check from flags or an Assumed/Projected field. */
function pickVerifyItem(ctx: AnalysisContext): string | null {
  const flags = ctx.flags ?? [];
  if (flags.some((f) => f.includes('on_ground'))) return 'the competitive count on site';
  const l = ctx.modules.lease as Rec & { ran?: boolean };
  if (l?.ran && (s(rd(l, 'verdict')) === 'insufficient_data' || rd(l, 'lowSample') === true)) return 'the true asking rent and comparable leases';
  const t = ctx.modules.territory as Rec & { ran?: boolean };
  if (t?.ran && s(rd(t, 'verdict')) === 'redistributes') return 'whether the nearby rivals genuinely share this catchment';
  const d = ctx.modules.daypart as Rec & { ran?: boolean };
  if (d?.ran && rd(d, 'noCatchmentData') === true) return 'the daytime-vs-residential foot traffic at the site';
  return 'foot traffic and the tenancy terms';
}

const lc = (x: string | null | undefined): string => (x ? x.toLowerCase() : 'medium');
