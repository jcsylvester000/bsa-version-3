/**
 * Branded, print-ready HTML report generator — design v2.
 *
 * Produces a single self-contained HTML document — cover page with client details, the confidence
 * read, every section of the run's intelligence (the 9 structured sections with their score bars /
 * range charts / statuses) and the per-site scorecards. The user opens it and prints to PDF.
 *
 * Design v2 (docs/DESIGN_V2_CHECKLIST.md, batch 10):
 * - Uses the app's LIGHT theme tokens (AA-contrast status colours on white) and the Grid type system
 *   (Cantata One headings, Poppins body, Judson accent). Printer-friendly: white pages, no ink floods.
 * - Status is never colour alone: every verdict is icon + word (✓ / ▲ / ✕ / —); Truth Layer chips are
 *   outlined glyph + word (✓ Verified · ≈ Assumed · ↗ Projected), matching the app.
 * - No price verdicts: rent metrics (`metric.neutral`, scorecard `lease`) are drawn in a neutral
 *   colour and described by position only; lease verdict words come from LEASE_POSITION_LABEL.
 * - CSP: the app sends a nonce-based script-src, which blocks inline `onclick`. The print button is
 *   wired by a nonce'd <script> (opts.nonce); without a nonce the button is omitted and the toolbar
 *   tells the user to press Ctrl/Cmd + P.
 *
 * AI-free: every figure comes from the composed module data and carries its Truth Layer.
 */
import type { ComposedReport, ComposedSection, ReportMetric } from './reportComposer';
import { manilaLongStamp } from '@/lib/util/manilaTime';
import { fmtInt } from '@/lib/util/format';
import type { Scorecard } from './scorecard';
import type { Confidence } from '@/lib/truth/truthLayer';
import { BROKER_DISCLAIMER_LONG, LEASE_POSITION_LABEL } from '@/lib/truth/guardrailCopy';
import { GRID_LOGO_DATA_URI } from '@/lib/pdf/gridLogo';

/** Client / preparation details collected from the modal — all optional, all escaped. */
export interface ReportClientDetails {
  ownerName?: string;
  company?: string;
  contactNumber?: string;
  preparedFor?: string;
  email?: string;
}

// --- Design v2 light-theme tokens (mirror app/globals.css [data-theme='light']) -------------
const C = {
  midnight: '#0E192F',
  nile: '#1C335E', // headings
  text: '#0E192F',
  muted: '#4A5873',
  border: '#D2D2D2', // Iron
  borderStrong: '#7A869B',
  panel: '#F0EEEA',
  page: '#F6F4F1',
  accent: '#BE8562', // Muesli — fills only
  accentText: '#8E5A3B',
  go: '#1E7A52',
  caution: '#8A5A00',
  nogo: '#B3261E',
  projected: '#6B4FB0',
  neutral: '#7A869B',
};

type Tone = 'go' | 'caution' | 'nogo' | 'muted';
const TONE_COLOR: Record<Tone, string> = { go: C.go, caution: C.caution, nogo: C.nogo, muted: C.muted };
const TONE_ICON: Record<Tone, string> = { go: '✓', caution: '▲', nogo: '✕', muted: '—' };

const CONF: Record<Confidence, { label: string; note: string; tone: Tone }> = {
  high: { label: 'High', note: 'safe to act on with normal diligence', tone: 'go' },
  med: { label: 'Medium', note: 'confirm key assumptions', tone: 'caution' },
  low: { label: 'Low', note: 'verify before acting', tone: 'nogo' },
};

/** HTML-escape a user/free-text value. */
function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function band(score: number, higherIsBetter: boolean): 'go' | 'caution' | 'nogo' {
  const s = higherIsBetter ? score : 100 - score;
  return s >= 70 ? 'go' : s >= 45 ? 'caution' : 'nogo';
}

/** Status: icon + word, coloured text (never a colour-only pill). */
function status(tone: Tone, label: string): string {
  return `<span class="status" style="color:${TONE_COLOR[tone]}"><span aria-hidden="true">${TONE_ICON[tone]}</span> ${esc(label)}</span>`;
}

/** Truth-Layer chip — outlined glyph + word, as in the app. */
function tlChip(layer: string): string {
  const color = layer === 'verified' ? C.go : layer === 'assumed' ? C.caution : C.projected;
  const glyph = layer === 'verified' ? '✓' : layer === 'assumed' ? '≈' : '↗';
  const label = layer.charAt(0).toUpperCase() + layer.slice(1);
  return `<span class="tl" style="color:${color};border-color:${color}">${glyph} ${label}</span>`;
}

/** A 0–100 score bar. `neutral` = a position, not a judgement (rent): one neutral colour. */
function scoreBar(score: number, higherIsBetter: boolean, neutral = false): string {
  const color = neutral ? C.neutral : TONE_COLOR[band(score, higherIsBetter)];
  const pct = Math.max(2, Math.min(100, score));
  return `<div class="bar"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

/** Verdict word → status. Lease positions are statements (muted, positional wording). */
function verdictStatus(v: string | undefined): string {
  if (!v) return '';
  const key = v.toLowerCase().trim();
  if (!key) return '';
  if (key in LEASE_POSITION_LABEL) return status('muted', LEASE_POSITION_LABEL[key as keyof typeof LEASE_POSITION_LABEL]);
  if (key === 'corridor benchmark') return status('muted', 'Corridor benchmark');
  const good = ['adds', 'go', 'screen_pass', 'strong', 'proceed'];
  const bad = ['redistributes', 'nogo', 'no-go', 'no_go', 'screen_fail'];
  const label = key.replace(/_/g, ' ');
  const nice = label.charAt(0).toUpperCase() + label.slice(1);
  return status(good.includes(key) ? 'go' : bad.includes(key) ? 'nogo' : 'caution', nice);
}

/** A min–median–max range chart (lease corridor). Neutral — a spread, not a judgement. */
function rangeChart(r: { min: number; median: number; max: number; n: number }): string {
  const span = Math.max(1, r.max - r.min);
  const medianPct = ((r.median - r.min) / span) * 100;
  return `
    <div class="range">
      <div class="range-track"><div class="range-marker" style="left:calc(${medianPct}% - 2px)"></div></div>
      <div class="range-labels">
        <span>₱${fmtInt(r.min)}</span>
        <span class="range-med">median ₱${fmtInt(r.median)} · n=${r.n}</span>
        <span>₱${fmtInt(r.max)}</span>
      </div>
    </div>`;
}

/** One metric row. */
function metricRow(m: ReportMetric): string {
  const higher = m.higherIsBetter ?? true;
  let mid = '';
  let right = '';
  if (m.range) {
    mid = rangeChart(m.range);
    right = verdictStatus(m.verdict) || '—';
  } else if (m.score != null) {
    mid = `<div class="scorewrap"><span class="score">${Math.round(m.score)}</span>${scoreBar(m.score, higher, m.neutral)}</div>`;
    right = verdictStatus(m.verdict);
  } else if (m.value) {
    mid = `<span class="mval">${esc(m.value)}</span>`;
    right = verdictStatus(m.verdict);
  } else {
    mid = '<span class="muted">—</span>';
    right = verdictStatus(m.verdict) || '—';
  }
  return `
    <div class="metric">
      <div class="metric-label">
        <div class="mlabel">${esc(m.label)} ${tlChip(m.truthLayer)}</div>
        ${m.note ? `<div class="mnote">${esc(m.note)}</div>` : ''}
      </div>
      <div class="metric-mid">${mid}</div>
      <div class="metric-right">${right}</div>
    </div>`;
}

/** Group metrics by site. */
function groupBySite(metrics: ReportMetric[]): Array<[string, ReportMetric[]]> {
  const map = new Map<string, ReportMetric[]>();
  for (const m of metrics) {
    const arr = map.get(m.siteLabel) ?? [];
    arr.push(m);
    map.set(m.siteLabel, arr);
  }
  return [...map.entries()];
}

/** One report section block. */
function sectionBlock(s: ComposedSection): string {
  const chips = Array.from(new Set(s.truthLayers)).map(tlChip).join('');
  let bodyHtml: string;
  if (!s.assessed) {
    bodyHtml = `<p class="unassessed"><strong>— Not assessed for this run.</strong> No supporting module data was produced, so this section is left blank rather than estimated.</p>`;
  } else if (s.metrics.length === 0) {
    bodyHtml = `<p class="muted">Confidence is derived from the Truth Layer mix on the first page — Verified (measured / sourced), Assumed (estimate with a stated basis), Projected (modelled).</p>`;
  } else {
    bodyHtml = groupBySite(s.metrics)
      .map(
        ([site, ms]) => `
      <div class="site-block">
        <div class="site-name">${esc(site)}</div>
        ${ms.map(metricRow).join('')}
      </div>`,
      )
      .join('');
  }
  return `
    <section class="section">
      <div class="section-head">
        <h2><span class="num">${s.number}</span>${esc(s.title)}</h2>
        <div class="chips">${chips}</div>
      </div>
      ${bodyHtml}
    </section>`;
}

const BAND_META: Record<string, { tone: Tone; label: string }> = {
  go: { tone: 'go', label: 'Proceed' },
  caution: { tone: 'caution', label: 'Proceed with caution' },
  nogo: { tone: 'nogo', label: 'No-Go' },
  insufficient: { tone: 'muted', label: 'Not enough data' },
};

/** One scorecard block (per site). */
function scorecardBlock(sc: Scorecard): string {
  const rows = sc.criteria
    .map((c) => {
      // Lease is a VALUE-vs-corridor position — neutral colour (no price verdict).
      const neutral = c.key === 'lease';
      const scoreCell =
        c.score != null
          ? `<div class="scorewrap"><span class="score">${Math.round(c.score)}</span>${scoreBar(c.score, true, neutral)}</div>`
          : `<span class="muted">— not assessed</span>`;
      return `
      <tr>
        <td class="sc-crit">
          <div class="mlabel">${esc(c.label)} ${c.truthLayer ? tlChip(c.truthLayer) : ''}</div>
          <div class="mnote">Weight ${Math.round(c.weight * 100)}%${c.note ? ` · ${esc(c.note)}` : ''}</div>
        </td>
        <td class="sc-bar">${scoreCell}</td>
      </tr>`;
    })
    .join('');
  const meta = BAND_META[sc.band] ?? BAND_META.insufficient;
  return `
    <div class="scorecard">
      <div class="sc-head">
        <div class="site-name" style="margin:0">${esc(sc.siteLabel)}</div>
        <div class="sc-verdict">
          ${status(meta.tone, meta.label)}${sc.composite != null ? `<span class="sc-comp">${Math.round(sc.composite)}<span class="muted"> / 100</span></span>` : ''}
        </div>
      </div>
      <table class="sc-table">${rows}</table>
    </div>`;
}

/** The full document. */
export function renderReportHtml(
  report: ComposedReport,
  scorecards: Scorecard[],
  client: ReportClientDetails,
  opts: { generatedAtISO: string; runVertical?: string | null; siteCount?: number; nonce?: string | null },
): string {
  const mix = report.truthLayerMix;
  const total = Math.max(1, mix.verified + mix.assumed + mix.projected);
  const pct = (n: number) => Math.round((n / total) * 100);
  const conf = CONF[report.confidence];
  const generated = manilaLongStamp(new Date(opts.generatedAtISO));
  const assessed = report.sections.filter((s) => s.assessed).length;
  const nonce = opts.nonce && /^[A-Za-z0-9+/=]+$/.test(opts.nonce) ? opts.nonce : null;

  // Cover meta rows — only render the ones the user filled.
  const coverRows = [
    ['Prepared for', client.preparedFor],
    ['Prepared by', client.ownerName],
    ['Company', client.company],
    ['Contact', client.contactNumber],
    ['Email', client.email],
  ]
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `<div class="cover-row"><span class="cover-k">${k}</span><span class="cover-v">${esc(v)}</span></div>`)
    .join('');

  const sectionsHtml = report.sections.map(sectionBlock).join('');
  const scorecardsHtml = scorecards.length
    ? `<section class="section"><div class="section-head"><h2><span class="num">★</span>Site scorecards</h2></div>${scorecards.map(scorecardBlock).join('')}</section>`
    : '';

  const printButton = nonce
    ? `<button id="print-btn" type="button">Download / Print PDF</button>
  <script nonce="${nonce}">document.getElementById('print-btn').addEventListener('click', function () { window.print(); });</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Site Intelligence Report — ${esc(report.brandName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Cantata+One&family=Judson:ital,wght@0,400;0,700;1,400&family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  html,body { margin:0; padding:0; background:${C.page}; color:${C.text};
    font-family:'Poppins',ui-sans-serif,system-ui,sans-serif; font-size:12.5px; line-height:1.6;
    -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  h1,h2,h3 { font-family:'Cantata One','Judson',Georgia,serif; font-weight:400; color:${C.nile}; margin:0; }
  .page { max-width:840px; margin:0 auto; }
  .sheet { background:#fff; margin:20px auto; padding:44px 52px; border:1px solid ${C.border}; border-radius:16px; }
  .muted { color:${C.muted}; }
  .overline { font-size:10.5px; letter-spacing:.12em; text-transform:uppercase; color:${C.muted}; font-weight:600; }

  /* Toolbar (screen only) */
  .toolbar { position:sticky; top:0; z-index:10; background:${C.midnight}; color:#EDF2FB; padding:12px 20px;
    display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .toolbar .t-title { font-weight:600; font-size:14px; }
  .toolbar .hint { font-size:12px; opacity:.8; margin-left:14px; font-weight:400; }
  .toolbar button { background:${C.accent}; color:${C.midnight}; border:0; border-radius:10px; min-height:44px; padding:0 20px;
    font-weight:600; font-size:14px; cursor:pointer; font-family:inherit; }
  .toolbar button:focus-visible { outline:none; box-shadow:0 0 0 2px ${C.midnight}, 0 0 0 4px #E2B985; }

  /* Cover — white page, printer-friendly */
  .cover { background:#fff; min-height:980px; padding:64px 60px; display:flex; flex-direction:column;
    border-left:10px solid ${C.nile}; }
  .cover .logo { height:60px; width:auto; align-self:flex-start; }
  .cover .brandbar { width:56px; height:6px; background:${C.accent}; border-radius:3px; margin:48px 0 20px; }
  .cover h1 { font-size:44px; line-height:1.12; margin:12px 0 10px; }
  .cover .sub { font-family:'Judson',Georgia,serif; color:${C.muted}; font-size:19px; margin-bottom:auto; }
  .cover .cover-meta { border-top:1px solid ${C.border}; padding-top:22px; margin-top:44px; }
  .cover-row { display:flex; padding:9px 0; border-bottom:1px solid ${C.border}; }
  .cover-k { width:160px; color:${C.muted}; font-size:11px; text-transform:uppercase; letter-spacing:.08em; font-weight:600; }
  .cover-v { color:${C.text}; font-weight:500; }
  .cover .gen { color:${C.muted}; font-size:11.5px; margin-top:26px; }
  .cover .disclaimer { color:${C.muted}; font-size:11px; margin-top:10px; line-height:1.55; border-top:1px solid ${C.border}; padding-top:10px; }
  .cover .disclaimer .ra { display:inline-block; border:1px solid ${C.border}; border-radius:4px; padding:0 6px; margin-right:6px; font-weight:600; font-size:10px; }

  /* Summary strip */
  .summary { display:grid; grid-template-columns:1fr 1fr 1.6fr; gap:14px; margin-bottom:30px; }
  .card { border:1px solid ${C.border}; border-radius:14px; padding:16px 18px; background:#fff; }
  .big { font-size:24px; font-weight:600; line-height:1.2; margin-top:6px; }
  .mixbar-track { height:10px; border-radius:6px; overflow:hidden; display:flex; gap:2px; margin:10px 0 8px; }
  .mix-legend { display:flex; flex-wrap:wrap; gap:14px; font-size:11.5px; color:${C.muted}; }
  .mix-legend b { font-weight:600; }

  .status { font-weight:600; white-space:nowrap; }
  .tl { display:inline-flex; align-items:center; gap:3px; font-size:10px; padding:1px 6px; border-radius:4px; border:1px solid;
    font-weight:600; letter-spacing:.04em; text-transform:uppercase; white-space:nowrap; vertical-align:middle; }

  /* Sections */
  .section { margin:30px 0; page-break-inside:auto; }
  .section-head { display:flex; align-items:center; justify-content:space-between; gap:12px; border-bottom:1px solid ${C.border};
    padding-bottom:10px; margin-bottom:14px; page-break-after:avoid; }
  .section-head h2 { font-size:20px; display:flex; align-items:center; gap:12px; }
  .num { display:inline-grid; place-items:center; width:30px; height:30px; border-radius:50%; background:${C.panel};
    color:${C.accentText}; font-family:'Poppins',sans-serif; font-size:13px; font-weight:600; }
  .chips { display:flex; flex-wrap:wrap; gap:5px; justify-content:flex-end; }
  .unassessed { border:1px dashed ${C.borderStrong}; border-radius:12px; padding:14px 16px; color:${C.muted}; margin:0; }
  .unassessed strong { color:${C.text}; }

  .site-block { border:1px solid ${C.border}; border-radius:12px; margin-bottom:12px; page-break-inside:avoid; overflow:hidden; }
  .site-name { font-weight:600; color:${C.text}; font-size:13.5px; padding:10px 16px; background:${C.panel}; border-bottom:1px solid ${C.border}; }
  .metric { display:grid; grid-template-columns:40% 1fr 150px; gap:14px; align-items:center; padding:10px 16px; border-top:1px solid ${C.border}; }
  .site-name + .metric { border-top:0; }
  .mlabel { color:${C.text}; display:flex; flex-wrap:wrap; align-items:center; gap:6px; }
  .mnote { font-size:11px; color:${C.muted}; margin-top:2px; }
  .metric-right { text-align:right; font-size:12px; }
  .mval { font-weight:600; }
  .scorewrap { display:flex; align-items:center; gap:10px; }
  .score { font-weight:600; font-size:15px; width:30px; font-variant-numeric:tabular-nums; }
  .bar { flex:1; height:7px; background:${C.panel}; border-radius:4px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:4px; }
  .range-track { position:relative; height:8px; border-radius:5px; background:${C.accent}55; }
  .range-marker { position:absolute; top:-3px; width:4px; height:14px; border-radius:2px; background:${C.text}; }
  .range-labels { display:flex; justify-content:space-between; font-size:11px; color:${C.muted}; margin-top:5px; }
  .range-med { color:${C.text}; font-weight:600; }

  /* Scorecards */
  .scorecard { border:1px solid ${C.border}; border-radius:12px; overflow:hidden; margin-bottom:14px; page-break-inside:avoid; }
  .sc-head { display:flex; justify-content:space-between; align-items:center; gap:12px; background:${C.panel}; padding:10px 16px; border-bottom:1px solid ${C.border}; }
  .sc-head .site-name { background:transparent; border:0; padding:0; }
  .sc-verdict { display:flex; align-items:center; gap:14px; }
  .sc-comp { font-size:18px; font-weight:600; font-variant-numeric:tabular-nums; }
  .sc-table { width:100%; border-collapse:collapse; }
  .sc-table td { padding:10px 16px; border-top:1px solid ${C.border}; vertical-align:middle; }
  .sc-table tr:first-child td { border-top:0; }
  .sc-bar { width:220px; }

  .footer { border-top:1px solid ${C.border}; margin-top:36px; padding-top:14px; color:${C.muted}; font-size:11px;
    display:flex; justify-content:space-between; gap:12px; }

  @media print {
    body { background:#fff; }
    .toolbar { display:none; }
    .sheet { border:0; border-radius:0; margin:0; padding:0 6px; max-width:100%; }
    .cover { min-height:0; height:980px; page-break-after:always; }
    .summary { grid-template-columns:1fr 1fr 1.6fr; }
    @page { margin:14mm; }
  }
  @media (max-width:700px) {
    .sheet { padding:24px 18px; border-radius:0; }
    .summary { grid-template-columns:1fr; }
    .metric { grid-template-columns:1fr; gap:6px; }
    .metric-right { text-align:left; }
    .cover { padding:36px 24px; border-left-width:6px; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <span class="t-title">Site Intelligence Report — ${esc(report.brandName)}<span class="hint">Save as PDF: Ctrl/Cmd + P → “Save as PDF”</span></span>
    ${printButton}
  </div>

  <!-- COVER -->
  <div class="page"><div class="cover">
    <img class="logo" src="${GRID_LOGO_DATA_URI}" alt="GRID Property Ventures" />
    <div class="brandbar"></div>
    <div class="overline">Site Intelligence Report</div>
    <h1>${esc(report.brandName)}</h1>
    <div class="sub">${opts.runVertical ? esc(opts.runVertical) + ' · ' : ''}${opts.siteCount ? esc(opts.siteCount) + ' candidate site' + (opts.siteCount === 1 ? '' : 's') + ' · ' : ''}franchise site analysis</div>
    <div class="cover-meta">
      ${coverRows || `<div class="cover-row"><span class="cover-v muted">Add client details in the download dialog to personalise this cover.</span></div>`}
    </div>
    <div class="gen">Generated ${esc(generated)} (Manila)</div>
    <div class="disclaimer"><span class="ra">RA 9646</span>${BROKER_DISCLAIMER_LONG} Projected and Assumed values are model- or estimate-based and should be validated before any commitment.</div>
  </div></div>

  <div class="page"><div class="sheet">
    <!-- SUMMARY -->
    <div class="summary">
      <div class="card">
        <div class="overline">Overall confidence</div>
        <div class="big">${status(conf.tone, conf.label)}</div>
        <div class="muted" style="font-size:11.5px">${conf.note}</div>
      </div>
      <div class="card">
        <div class="overline">Sections assessed</div>
        <div class="big">${assessed} <span class="muted" style="font-size:13px;font-weight:400">of ${report.sections.length}</span></div>
        <div class="muted" style="font-size:11.5px">Unassessed sections are left blank, never estimated.</div>
      </div>
      <div class="card">
        <div class="overline">Where the figures come from</div>
        <div class="mixbar-track">
          <div style="width:${pct(mix.verified)}%;background:${C.go}"></div>
          <div style="width:${pct(mix.assumed)}%;background:${C.caution}"></div>
          <div style="width:${pct(mix.projected)}%;background:${C.projected}"></div>
        </div>
        <div class="mix-legend">
          <span><b style="color:${C.go}">✓ ${pct(mix.verified)}%</b> Verified</span>
          <span><b style="color:${C.caution}">≈ ${pct(mix.assumed)}%</b> Assumed</span>
          <span><b style="color:${C.projected}">↗ ${pct(mix.projected)}%</b> Projected</span>
        </div>
      </div>
    </div>

    ${sectionsHtml}
    ${scorecardsHtml}

    <div class="footer">
      <span>Site Intelligence Report · ${esc(report.brandName)}</span>
      <span>${esc(generated)}</span>
    </div>
  </div></div>
</body>
</html>`;
}
