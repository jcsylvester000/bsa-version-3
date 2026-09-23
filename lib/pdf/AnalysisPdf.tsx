/**
 * Branded Analysis Report PDF (server-rendered via @react-pdf/renderer).
 *
 * Grid Property Ventures identity: the logo, Nile Blue / Muesli palette, a clean print layout,
 * the AI narrative up top, the site data below, and the compliance footer on every page.
 * Rendered only on the server (see app/api/analysis-report/pdf/route.ts); @react-pdf is kept
 * external in next.config so it is never bundled to the client.
 *
 * Uses the built-in Helvetica family (reliable on serverless). Grid's Cantata One / Poppins
 * can be layered in later by registering the TTFs; the logo + palette carry the brand today.
 */
import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet } from '@react-pdf/renderer';
import { GRID_LOGO_DATA_URI } from './gridLogo';
import { BROKER_DISCLAIMER_LONG } from '@/lib/truth/guardrailCopy';

// Grid brand palette (guidelines).
const C = {
  nile: '#1C335E',
  muesli: '#BE8562',
  ink: '#243044',
  muted: '#5b6472',
  line: '#d8dce3',
  verified: '#2f8f63',
  assumed: '#b6822f',
  projected: '#6f56a8',
  white: '#ffffff',
};

const styles = StyleSheet.create({
  page: { paddingTop: 42, paddingBottom: 104, paddingHorizontal: 46, fontSize: 10, color: C.ink, fontFamily: 'Helvetica', lineHeight: 1.5 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  logo: { width: 128 },
  kicker: { fontSize: 8, letterSpacing: 1.5, color: C.muesli, fontFamily: 'Helvetica-Bold' },
  h1: { fontSize: 17, color: C.nile, fontFamily: 'Helvetica-Bold', marginTop: 10 },
  meta: { fontSize: 9, color: C.muted, marginTop: 3 },
  chipRow: { flexDirection: 'row', marginTop: 6 },
  chip: { fontSize: 8, color: C.white, backgroundColor: C.nile, paddingVertical: 2, paddingHorizontal: 6, borderRadius: 3 },
  rule: { height: 2, backgroundColor: C.muesli, marginTop: 12, marginBottom: 14, width: 54 },
  sectionTitle: { fontSize: 11, color: C.nile, fontFamily: 'Helvetica-Bold', marginTop: 14, marginBottom: 6 },
  para: { marginBottom: 8 },
  dataHeader: { fontSize: 9.5, color: C.nile, fontFamily: 'Helvetica-Bold', marginTop: 9, marginBottom: 2 },
  dataRow: { paddingLeft: 10, marginBottom: 2 },
  otherLine: { fontSize: 9, color: C.muted, marginBottom: 2 },
  footer: { position: 'absolute', bottom: 28, left: 46, right: 80, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 6 },
  footerText: { fontSize: 7.5, color: C.muted, lineHeight: 1.4 },
  pageNo: { position: 'absolute', bottom: 28, right: 46, fontSize: 8, color: C.muted },
});

export interface AnalysisPdfProps {
  siteLabel: string;
  brand?: string | null;
  location?: string | null;
  dateStr: string;
  confidence?: string | null;
  narrative: string;
  schemaText: string;
  /** Guardrail-check warning (figures not traceable to the data / price-verdict wording). */
  checkWarning?: string | null;
}

function truthColor(t: string): string {
  const s = t.toLowerCase();
  return s.includes('verified') ? C.verified : s.includes('assumed') ? C.assumed : C.projected;
}

/** The @react-pdf document. Returns a <Document> element for renderToBuffer. */
export function AnalysisPdf(p: AnalysisPdfProps): React.ReactElement {
  const paras = p.narrative.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean);
  const lines = p.schemaText ? p.schemaText.split('\n') : [];
  const metaLine = [p.brand, p.location].filter(Boolean).join(' · ');

  return (
    <Document title={`BSA Site Analysis — ${p.siteLabel}`} author="Grid Property Ventures" subject="Business Site Analysis">
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <Image src={GRID_LOGO_DATA_URI} style={styles.logo} />
          <Text style={styles.kicker}>SITE ANALYSIS REPORT</Text>
        </View>

        <Text style={styles.h1}>{p.siteLabel}</Text>
        <Text style={styles.meta}>{metaLine ? `${metaLine} · ` : ''}Generated {p.dateStr}</Text>
        {p.confidence ? (
          <View style={styles.chipRow}>
            <Text style={styles.chip}>Confidence: {p.confidence}</Text>
          </View>
        ) : null}
        <View style={styles.rule} />

        <Text style={styles.sectionTitle}>Analysis</Text>
        {paras.length > 0
          ? paras.map((t, i) => <Text key={i} style={styles.para}>{t}</Text>)
          : <Text style={styles.para}>{p.narrative}</Text>}
        {p.checkWarning ? (
          <Text style={[styles.para, { color: C.assumed, fontSize: 9 }]}>
            Automated check — verify before relying on this text: {p.checkWarning}.
          </Text>
        ) : null}

        {lines.length > 0 ? (
          <View wrap>
            <Text style={styles.sectionTitle}>Site data</Text>
            {lines.map((raw, i) => {
              const line = raw.replace(/\s+$/, '');
              if (!line.trim()) return <View key={i} style={{ height: 4 }} />;

              const hm = line.match(/^\[(.+?)\]\s*(.*)$/);
              if (hm) return <Text key={i} style={styles.dataHeader}>{hm[1]}{hm[2] ? ` ${hm[2]}` : ''}</Text>;

              const rm = line.match(/^-\s*(.*?):\s*(.*)$/);
              if (rm) {
                const label = rm[1];
                let value = rm[2];
                let truth = '';
                const tm = value.match(/\(([^)]+)\)\s*$/);
                if (tm && /verified|assumed|projected/i.test(tm[1])) {
                  truth = tm[1];
                  value = value.replace(/\s*\([^)]+\)\s*$/, '');
                }
                return (
                  <View key={i} style={styles.dataRow}>
                    <Text>
                      {label}: <Text style={{ fontFamily: 'Helvetica-Bold' }}>{value}</Text>
                      {truth ? <Text style={{ color: truthColor(truth) }}>{'  '}({truth})</Text> : null}
                    </Text>
                  </View>
                );
              }

              return <Text key={i} style={styles.otherLine}>{line}</Text>;
            })}
          </View>
        ) : null}

        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Business Site Analysis (BSA) · Grid Property Ventures. {BROKER_DISCLAIMER_LONG}
          </Text>
        </View>
        <Text style={styles.pageNo} fixed render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
      </Page>
    </Document>
  );
}
