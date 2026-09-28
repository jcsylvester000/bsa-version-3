/**
 * Site Final Report PDF (server-rendered via @react-pdf/renderer) — design v2.
 *
 * Renders the SAME `SiteReportModel` the Final Report tab renders (lib/modules/siteReportModel.ts), as
 * real text and tables — not a screenshot: the recommendation hero (call, composite, rank, rationale,
 * confidence, coverage, analysed time, Truth Layer mix), "What drove this call" (status, finding,
 * headline figure + Truth Layer, module) with keywords, and the four module summaries with every row
 * and its Truth Layer, then the footnote and the RA 9646 notice on every page.
 *
 * Print palette = the app's light theme (AA status colours on white). Fonts = Grid type system
 * (Cantata One / Poppins / Judson) with Noto subsets as fallbacks for ₱ ✓ ▲ ✕ ≈ ⇗ ≤ (lib/pdf/pdfFonts.ts).
 * Statuses are icon + word; rent is never coloured good/bad (lease statuses are muted statements).
 * Server-only: @react-pdf is kept external in next.config and never bundled to the client.
 */
import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, Font } from '@react-pdf/renderer';
import { GRID_LOGO_DATA_URI } from './gridLogo';
import {
  POPPINS_400, POPPINS_600, CANTATA_400, JUDSON_400, NOTO_PESO, NOTO_MATH_SUBSET, NOTO_SYMBOLS_SUBSET,
} from './pdfFonts';
import { BROKER_DISCLAIMER_LONG } from '@/lib/truth/guardrailCopy';
import type { SiteReportModel, ModuleSummaryModel } from '@/lib/modules/siteReportModel';
import type { Tone } from '@/lib/modules/siteVerdict';
import type { TruthLayer } from '@/lib/truth/truthLayer';

// --- Fonts (registered once per process) -----------------------------------------------------
let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  Font.register({ family: 'Poppins', fonts: [{ src: POPPINS_400, fontWeight: 400 }, { src: POPPINS_600, fontWeight: 600 }] });
  Font.register({ family: 'Cantata', src: CANTATA_400 });
  Font.register({ family: 'Judson', src: JUDSON_400 });
  Font.register({ family: 'NotoPeso', src: NOTO_PESO });
  Font.register({ family: 'NotoMath', src: NOTO_MATH_SUBSET });
  Font.register({ family: 'NotoSymbols', src: NOTO_SYMBOLS_SUBSET });
  // Never hyphenate names, barangays or figures.
  Font.registerHyphenationCallback((word) => [word]);
  fontsReady = true;
}
const FALLBACK = ['NotoPeso', 'NotoMath', 'NotoSymbols'];
const BODY = ['Poppins', ...FALLBACK] as unknown as string;
const HEAD = ['Cantata', ...FALLBACK] as unknown as string;
const SERIF = ['Judson', ...FALLBACK] as unknown as string;

// --- Light-theme print palette (mirrors app/globals.css [data-theme='light']) -----------------
const C = {
  text: '#0E192F',
  heading: '#1C335E',
  muted: '#4A5873',
  border: '#D2D2D2',
  borderStrong: '#7A869B',
  panel: '#F0EEEA',
  accent: '#BE8562',
  accentText: '#8E5A3B',
  go: '#1E7A52',
  caution: '#8A5A00',
  nogo: '#B3261E',
  projected: '#6B4FB0',
  white: '#FFFFFF',
};
const TONE_COLOR: Record<Tone, string> = { go: C.go, caution: C.caution, nogo: C.nogo, muted: C.muted };
const TONE_ICON: Record<Tone, string> = { go: '✓', caution: '▲', nogo: '✕', muted: 'i' };
const TONE_WORD: Record<Tone, string> = { go: 'Proceed', caution: 'Caution', nogo: 'No-Go', muted: 'Context' };
const TRUTH: Record<TruthLayer, { color: string; glyph: string; label: string }> = {
  verified: { color: C.go, glyph: '✓', label: 'Verified' },
  assumed: { color: C.caution, glyph: '≈', label: 'Assumed' },
  // ⇗ not ↗: react-pdf treats U+2197 as an emoji and drops it (see lib/pdf/FONTS_LICENSE.md).
  projected: { color: C.projected, glyph: '⇗', label: 'Projected' },
};

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 70, paddingHorizontal: 40, fontSize: 9, color: C.text, fontFamily: BODY, lineHeight: 1.45 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 112 },
  kicker: { fontSize: 7.5, letterSpacing: 1.2, color: C.accentText, fontWeight: 600 },
  overline: { fontSize: 7.5, letterSpacing: 1, color: C.muted, fontWeight: 600, textTransform: 'uppercase' },
  h1: { fontFamily: HEAD, fontSize: 22, color: C.heading, marginTop: 4 },
  h2: { fontFamily: HEAD, fontSize: 14, color: C.heading },
  sub: { fontSize: 9, color: C.muted, marginTop: 2 },
  rule: { height: 3, width: 44, backgroundColor: C.accent, borderRadius: 2, marginTop: 10, marginBottom: 12 },

  hero: { flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: 10, overflow: 'hidden' },
  heroLeft: { width: 170, padding: 14, justifyContent: 'space-between' },
  heroRight: { flex: 1, padding: 14 },
  heroIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center' },
  heroLabel: { fontFamily: HEAD, fontSize: 20, color: C.white, marginTop: 4 },
  heroComposite: { flexDirection: 'row', alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.45)', paddingTop: 8, marginTop: 10 },
  rationale: { fontFamily: SERIF, fontSize: 12.5, lineHeight: 1.35, color: C.text },
  metaRow: { flexDirection: 'row', marginTop: 10, flexWrap: 'wrap' },
  metaCell: { marginRight: 22, marginBottom: 6 },
  metaValue: { fontSize: 10, fontWeight: 600, marginTop: 1 },

  mixTrack: { flexDirection: 'row', height: 7, borderRadius: 4, overflow: 'hidden', marginTop: 4, marginBottom: 4 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap' },

  card: { borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 14, marginBottom: 6 },

  findRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.border, paddingVertical: 6 },
  statusCell: { width: 78, flexDirection: 'row', alignItems: 'center' },
  dot: { width: 13, height: 13, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  kwRow: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  kw: { fontSize: 7.5, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 6, marginRight: 4, marginBottom: 3 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  modCard: { width: '49%', borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 10, marginBottom: 8 },
  modHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modTitle: { fontSize: 10, fontWeight: 600, color: C.text, marginRight: 8, marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 0.5, borderBottomColor: C.border, paddingVertical: 3.5 },
  rowLabel: { width: '40%', color: C.muted, paddingRight: 6 },
  rowValue: { width: '60%', flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },

  chip: { flexDirection: 'row', alignItems: 'center', borderWidth: 0.8, borderRadius: 3, paddingHorizontal: 3, paddingVertical: 0.5, marginLeft: 4 },
  chipText: { fontSize: 6.5, fontWeight: 600, letterSpacing: 0.4 },

  footnote: { fontSize: 7.5, color: C.muted, marginTop: 6 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 76, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 5, flexDirection: 'row' },
  footerRa: { fontSize: 6.5, fontWeight: 600, borderWidth: 0.8, borderColor: C.border, borderRadius: 3, paddingHorizontal: 3, marginRight: 5, color: C.muted },
  footerText: { flex: 1, fontSize: 6.5, color: C.muted, lineHeight: 1.35 },
  pageNo: { position: 'absolute', bottom: 24, right: 40, fontSize: 7.5, color: C.muted },
});

export interface AnalysisPdfProps {
  model: SiteReportModel;
  siteLabel: string;
  brand?: string | null;
  location?: string | null;
  /** Pre-formatted Manila time of generation. */
  generatedAt: string;
}

/** Truth Layer chip — outlined glyph + word (compact = glyph only, like the app's table rows). */
function TruthChip({ layer, compact = false }: { layer: TruthLayer; compact?: boolean }) {
  const t = TRUTH[layer];
  return (
    <View style={[s.chip, { borderColor: t.color }]}>
      <Text style={[s.chipText, { color: t.color }]}>{compact ? t.glyph : `${t.glyph} ${t.label.toUpperCase()}`}</Text>
    </View>
  );
}

/** Status: coloured icon disc + word (never colour alone). */
function Status({ tone, label, size = 8.5 }: { tone: Tone; label: string; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexShrink: 1 }}>
      <View style={[s.dot, { backgroundColor: TONE_COLOR[tone] }]}>
        <Text style={{ fontSize: 7, color: C.white, fontWeight: 600 }}>{TONE_ICON[tone]}</Text>
      </View>
      <Text style={{ fontSize: size, fontWeight: 600, color: TONE_COLOR[tone], flexShrink: 1 }}>{label}</Text>
    </View>
  );
}

function ModuleCard({ mod }: { mod: ModuleSummaryModel }) {
  return (
    <View style={s.modCard} wrap={false}>
      <View style={s.modHead}>
        <Text style={s.modTitle}>{mod.title}</Text>
        {mod.ran && mod.status ? <Status tone={mod.status.tone} label={mod.status.label} size={7.5} /> : !mod.ran ? <Status tone="muted" label="Not run" size={7.5} /> : null}
      </View>
      {mod.contextual && mod.ran ? (
        <Text style={{ fontSize: 7.5, color: C.projected, marginBottom: 3 }}>Contextual read for this format — carries lower weight in the decision.</Text>
      ) : null}
      {mod.lead ? <Text style={{ fontSize: 7.5, color: C.muted, marginBottom: 3 }}>{mod.lead}</Text> : null}
      {mod.rows.map((r, i) => (
        <View key={i} style={[s.row, i === mod.rows.length - 1 ? { borderBottomWidth: 0 } : {}]}>
          <Text style={s.rowLabel}>{r.label}</Text>
          <View style={s.rowValue}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: 600, textAlign: 'right' }}>{r.value}</Text>
            </View>
            <View style={{ width: 18, alignItems: 'flex-end' }}>
              {r.truth ? <TruthChip layer={r.truth} compact /> : null}
            </View>
          </View>
        </View>
      ))}
      {mod.emptyText ? (
        <Text style={{ fontSize: 8, color: C.muted, marginTop: 3 }}>{mod.emptyText}</Text>
      ) : null}
    </View>
  );
}

/** The @react-pdf document. Returns a <Document> element for renderToBuffer. */
export function AnalysisPdf(p: AnalysisPdfProps): React.ReactElement {
  registerFonts();
  const m = p.model;
  const sum = m.summary;
  const heroTone: Tone = m.limited ? 'muted' : sum.tone;
  const heroBg = m.limited ? C.panel : TONE_COLOR[sum.tone];
  const heroInk = m.limited ? C.text : C.white;
  const conf = m.meta.confidence;
  const confLabel = conf === 'high' ? 'High' : conf === 'low' ? 'Low' : conf === 'med' ? 'Medium' : null;
  const confNote = conf === 'high' ? 'safe to act on with normal diligence' : conf === 'low' ? 'verify before acting' : 'confirm key assumptions';
  const metaLine = [p.brand, p.location].filter(Boolean).join(' · ');

  return (
    <Document title={`Site Final Report — ${p.siteLabel}`} author="Grid Property Ventures" subject="Business Site Analysis — Final Report">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.headerRow}>
          <Image src={GRID_LOGO_DATA_URI} style={s.logo} />
          <Text style={s.kicker}>SITE FINAL REPORT</Text>
        </View>
        <View style={{ marginTop: 12 }}>
          {metaLine ? <Text style={s.overline}>{metaLine}</Text> : null}
          <Text style={s.h1}>{p.siteLabel}</Text>
          <Text style={s.sub}>Full site intelligence — one site, every module. Generated {p.generatedAt} (Manila).</Text>
        </View>
        <View style={s.rule} />

        {/* Recommendation hero */}
        <View style={s.hero} wrap={false}>
          <View style={[s.heroLeft, { backgroundColor: heroBg }]}>
            <View>
              <View style={[s.heroIcon, m.limited ? { borderWidth: 1, borderColor: C.borderStrong, borderStyle: 'dashed' } : {}]}>
                <Text style={{ fontSize: 15, fontWeight: 600, color: m.limited ? C.muted : TONE_COLOR[heroTone] }}>{m.limited ? '—' : TONE_ICON[heroTone]}</Text>
              </View>
              <Text style={{ fontSize: 7, letterSpacing: 1, fontWeight: 600, color: heroInk, marginTop: 8 }}>RECOMMENDATION</Text>
              <Text style={[s.heroLabel, { color: heroInk }]}>{m.limited ? 'Not enough data yet' : sum.label}</Text>
            </View>
            <View style={[s.heroComposite, m.limited ? { borderTopColor: C.border } : {}]}>
              {!m.limited && m.meta.composite != null ? (
                <>
                  <Text style={{ fontSize: 24, fontWeight: 600, color: heroInk, lineHeight: 1 }}>{Math.round(m.meta.composite)}</Text>
                  <Text style={{ fontSize: 8.5, color: heroInk, marginLeft: 3, marginBottom: 2 }}>/ 100 composite</Text>
                </>
              ) : (
                <Text style={{ fontSize: 8.5, color: heroInk }}>{sum.coverage} of 3 core modules</Text>
              )}
              {m.meta.rank != null && m.meta.total != null ? (
                <Text style={{ fontSize: 7.5, fontWeight: 600, color: heroInk, marginLeft: 'auto', marginBottom: 2 }}>Rank {m.meta.rank} of {m.meta.total}</Text>
              ) : null}
            </View>
          </View>
          <View style={s.heroRight}>
            <Text style={s.rationale}>{sum.headline}</Text>
            {!m.limited && sum.coverage < 2 ? (
              <Text style={{ fontSize: 7.5, color: C.muted, marginTop: 4 }}>
                Limited module data — {sum.coverage} of 3 core modules rated. The call follows the site’s composite score; confirm on the ground.
              </Text>
            ) : null}
            <View style={s.metaRow}>
              {confLabel ? (
                <View style={s.metaCell}>
                  <Text style={s.overline}>Confidence</Text>
                  <Text style={s.metaValue}>{confLabel} <Text style={{ fontSize: 7.5, fontWeight: 400, color: C.muted }}>· {confNote}</Text></Text>
                </View>
              ) : null}
              <View style={s.metaCell}>
                <Text style={s.overline}>Coverage</Text>
                <Text style={s.metaValue}>{m.coverageText}</Text>
              </View>
              {m.meta.analysedAt ? (
                <View style={s.metaCell}>
                  <Text style={s.overline}>Analysed</Text>
                  <Text style={s.metaValue}>{m.meta.analysedAt} <Text style={{ fontSize: 7.5, fontWeight: 400, color: C.muted }}>Manila</Text></Text>
                </View>
              ) : null}
            </View>
            {m.truthPct ? (
              <View style={{ marginTop: 4 }}>
                <Text style={s.overline}>Where the figures come from</Text>
                <View style={s.mixTrack}>
                  <View style={{ width: `${m.truthPct.verified}%`, backgroundColor: C.go }} />
                  <View style={{ width: `${m.truthPct.assumed}%`, backgroundColor: C.caution }} />
                  <View style={{ width: `${m.truthPct.projected}%`, backgroundColor: C.projected }} />
                </View>
                <View style={s.legendRow}>
                  <Text style={{ fontSize: 7.5, color: C.muted, marginRight: 12 }}><Text style={{ color: C.go, fontWeight: 600 }}>✓ {m.truthPct.verified}%</Text> Verified</Text>
                  <Text style={{ fontSize: 7.5, color: C.muted, marginRight: 12 }}><Text style={{ color: C.caution, fontWeight: 600 }}>≈ {m.truthPct.assumed}%</Text> Assumed</Text>
                  <Text style={{ fontSize: 7.5, color: C.muted }}><Text style={{ color: C.projected, fontWeight: 600 }}>⇗ {m.truthPct.projected}%</Text> Projected</Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>

        {/* What drove this call */}
        {sum.findings.length > 0 ? (
          <View style={[s.card, { marginTop: 12 }]} wrap={false}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
              <Text style={s.h2}>What drove this call</Text>
              <Text style={{ fontSize: 7.5, color: C.muted }}>Each finding traces to a module</Text>
            </View>
            {sum.findings.map((f, i) => {
              const fig = m.figures[f.keyword];
              const mod = m.findingModule[f.keyword];
              return (
                <View key={i} style={s.findRow}>
                  <View style={s.statusCell}><Status tone={f.tone} label={TONE_WORD[f.tone]} size={8} /></View>
                  <Text style={{ flex: 1, paddingRight: 8 }}>
                    <Text style={{ fontWeight: 600 }}>{f.keyword}: </Text>
                    <Text style={{ color: C.muted }}>{f.detail}</Text>
                  </Text>
                  {fig ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 8 }}>
                      <Text style={{ fontWeight: 600 }}>{fig.value}</Text>
                      <TruthChip layer={fig.truth} compact />
                    </View>
                  ) : null}
                  {mod ? <Text style={{ width: 78, textAlign: 'right', color: C.accentText, fontSize: 8 }}>{mod.label}</Text> : null}
                </View>
              );
            })}
            {sum.keywords.length > 0 ? (
              <View style={s.kwRow}>
                {sum.keywords.map((k) => <Text key={k} style={s.kw}>{k}</Text>)}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Module summaries */}
        <View style={[s.sectionHead, { marginTop: 0 }]} break>
          <Text style={s.h2}>Module summaries</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ fontSize: 7.5, color: C.muted }}>Truth Layer:</Text>
            <TruthChip layer="verified" /><TruthChip layer="assumed" /><TruthChip layer="projected" />
          </View>
        </View>
        <View style={s.grid}>
          {m.modules.map((mod) => <ModuleCard key={mod.key} mod={mod} />)}
        </View>
        <Text style={s.footnote}>{m.footnote}</Text>

        {/* Footer on every page */}
        <View style={s.footer} fixed>
          <Text style={s.footerRa}>RA 9646</Text>
          <Text style={s.footerText}>Business Site Analysis (BSA) · Grid Property Ventures. {BROKER_DISCLAIMER_LONG}</Text>
        </View>
        <Text style={s.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
