/**
 * Branded, print-ready HTML report generator.
 *
 * Produces a single self-contained HTML document — cover page with client details, then
 * every section of the run's intelligence (exec summary, the 9 structured sections with
 * their score bars / range charts / verdict pills, per-site scorecards, and the Truth-Layer
 * confidence read). The user opens it and prints to PDF (Ctrl/Cmd-P → Save as PDF).
 *
 * Uses the Grid brand system (amber accent, dark-navy → light print surfaces, Poppins
 * headings / Calibri body, Truth-Layer green/amber/violet) WITHOUT naming the product —
 * per the brief, colours/themes/fonts only. All CSS is inlined; no external assets beyond
 * the Google-fonts link, so a saved copy renders offline too.
 *
 * AI-free: every figure comes from the composed module data and carries its Truth Layer.
 */
import type { ComposedReport, ComposedSection, ReportMetric } from './reportComposer';
import { manilaLongStamp } from '@/lib/util/manilaTime';
import type { Scorecard } from './scorecard';
import type { Confidence } from '@/lib/truth/truthLayer';

/** Client / preparation details collected from the modal — all optional, all escaped. */
export interface ReportClientDetails {
  ownerName?: string;
  company?: string;
  contactNumber?: string;
  preparedFor?: string;
  email?: string;
}

// --- Grid brand tokens (mirrors tailwind.config.ts) --------------------------
const C = {
  accent: '#e0a568',
  ink: '#16233f', // deep navy for headings on the light print surface
  body: '#2c3648',
  muted: '#6b7688',
  border: '#e2e6ee',
  panel: '#f6f8fc',
  verified: '#38a574',
  assumed: '#d9a441',
  projected: '#9b7bd4',
  go: '#38a574',
  caution: '#d9a441',
  nogo: '#d9534f',
};

const CONF_LABEL: Record<Confidence, string> = { high: 'High', med: 'Medium', low: 'Low' };
const CONF_COLOR: Record<Confidence, string> = { high: C.go, med: C.caution, low: C.nogo };

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
function bandColor(b: 'go' | 'caution' | 'nogo' | 'insufficient'): string {
  return b === 'go' ? C.go : b === 'nogo' ? C.nogo : b === 'insufficient' ? C.muted : C.caution;
}

/** A Truth-Layer chip. */
function tlChip(layer: string): string {
  const color = layer === 'verified' ? C.verified : layer === 'assumed' ? C.assumed : C.projected;
  const label = layer.charAt(0).toUpperCase() + layer.slice(1);
  return `<span class="tl" style="color:${color};border-color:${color}33;background:${color}14">${label}</span>`;
}

/** A 0–100 score bar. */
function scoreBar(score: number, higherIsBetter: boolean): string {
  const b = band(score, higherIsBetter);
  const color = bandColor(b);
  const pct = Math.max(2, Math.min(100, score));
  return `<div class="bar"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

/** A verdict pill (adds / redistributes / below_market …). */
function verdictPill(v: string | undefined): string {
  if (!v) return '';
  const key = v.toLowerCase();
  const good = ['adds', 'below_market', 'go', 'screen_pass', 'strong'];
  const bad = ['redistributes', 'above_market', 'nogo', 'no-go', 'screen_fail'];
  const label = esc(key.replace(/_/g, ' '));
  const color = good.includes(key) ? C.go : bad.includes(key) ? C.nogo : C.accent;
  return `<span class="pill" style="color:${color};background:${color}18">${label}</span>`;
}

/** A min–median–max range chart (lease corridor). */
function rangeChart(r: { min: number; median: number; max: number; n: number }): string {
  const span = Math.max(1, r.max - r.min);
  const medianPct = ((r.median - r.min) / span) * 100;
  return `
    <div class="range">
      <div class="range-track"><div class="range-marker" style="left:${medianPct}%"></div></div>
      <div class="range-labels">
        <span>₱${r.min.toLocaleString()}</span>
        <span class="range-med">median ₱${r.median.toLocaleString()} · n=${r.n}</span>
        <span>₱${r.max.toLocaleString()}</span>
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
    right = m.verdict ? verdictPill(m.verdict) : '—';
  } else if (m.score != null) {
    mid = scoreBar(m.score, higher);
    const b = band(m.score, higher);
    right = `<strong style="color:${bandColor(b)}">${Math.round(m.score)}</strong>`;
  } else if (m.value) {
    mid = `<span class="mval">${esc(m.value)}</span>`;
    right = m.verdict ? verdictPill(m.verdict) : '';
  } else {
    right = m.verdict ? verdictPill(m.verdict) : '—';
  }
  return `
    <div class="metric">
      <div class="metric-label">
        <div>${esc(m.label)}</div>
        <div class="metric-sub">${tlChip(m.truthLayer)}${m.note ? ` <span class="mnote">${esc(m.note)}</span>` : ''}</div>
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
    bodyHtml = `<p class="unassessed">Not assessed for this run — no supporting module data was produced. Left blank rather than estimated.</p>`;
  } else if (s.metrics.length === 0) {
    bodyHtml = `<p class="muted">Confidence is derived from the Truth-Layer mix shown on the confidence page — Verified (measured/sourced), Assumed (estimate with basis), Projected (modelled).</p>`;
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
        <h2>${s.number}. ${esc(s.title)}</h2>
        <div class="chips">${chips}</div>
      </div>
      ${bodyHtml}
    </section>`;
}

/** One scorecard block (per site). */
function scorecardBlock(sc: Scorecard): string {
  const rows = sc.criteria
    .map((c) => {
      const scoreCell =
        c.score != null
          ? `${scoreBar(c.score, true)}<span class="sc-score" style="color:${bandColor(band(c.score, true))}">${Math.round(c.score)}</span>`
          : `<span class="muted">— not assessed</span>`;
      return `
      <tr>
        <td class="sc-crit">
          <div>${esc(c.label)}</div>
          <div class="sc-meta">Weight ${Math.round(c.weight * 100)}%${c.truthLayer ? ` · ${tlChip(c.truthLayer)}` : ''}</div>
          <div class="sc-note">${esc(c.note)}</div>
        </td>
        <td class="sc-bar">${scoreCell}</td>
      </tr>`;
    })
    .join('');
  const bandLabel = sc.band === 'go' ? 'GO' : sc.band === 'nogo' ? 'NO-GO' : sc.band === 'insufficient' ? 'INSUFFICIENT' : 'CAUTION';
  return `
    <div class="scorecard">
      <div class="sc-head">
        <div class="sc-site">${esc(sc.siteLabel)}</div>
        <div class="sc-verdict" style="background:${bandColor(sc.band)}">
          ${bandLabel}${sc.composite != null ? ` · ${Math.round(sc.composite)}/100` : ''}
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
  opts: { generatedAtISO: string; runVertical?: string | null; siteCount?: number },
): string {
  const mix = report.truthLayerMix;
  const total = Math.max(1, mix.verified + mix.assumed + mix.projected);
  const seg = (n: number) => `${(n / total) * 100}%`;
  const conf = report.confidence;
  const generated = manilaLongStamp(new Date(opts.generatedAtISO));

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
    ? `<section class="section"><div class="section-head"><h2>Site Scorecards</h2></div>${scorecards.map(scorecardBlock).join('')}</section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Site Intelligence Report — ${esc(report.brandName)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; }
  :root { --accent:${C.accent}; --ink:${C.ink}; --body:${C.body}; --muted:${C.muted}; --border:${C.border}; --panel:${C.panel}; }
  html,body { margin:0; padding:0; background:#eef1f7; color:var(--body);
    font-family:'Inter','Calibri',ui-sans-serif,system-ui,sans-serif; font-size:13px; line-height:1.55; }
  h1,h2,h3 { font-family:'Poppins',ui-sans-serif,system-ui,sans-serif; color:var(--ink); margin:0; }
  .page { max-width:820px; margin:0 auto; }
  .sheet { background:#fff; margin:18px auto; padding:40px 48px; box-shadow:0 2px 14px rgba(20,35,63,.08); }
  .muted { color:var(--muted); }
  a { color:var(--accent); }

  /* Toolbar (screen only) */
  .toolbar { position:sticky; top:0; z-index:10; background:${C.ink}; color:#fff; padding:12px 20px;
    display:flex; align-items:center; justify-content:space-between; font-family:'Poppins',sans-serif; }
  .toolbar .t-title { font-weight:600; font-size:14px; }
  .toolbar button { background:var(--accent); color:${C.ink}; border:0; border-radius:8px; padding:9px 18px;
    font-weight:600; font-size:13px; cursor:pointer; font-family:'Poppins',sans-serif; }
  .toolbar .hint { font-size:11px; opacity:.75; margin-left:14px; font-family:'Inter',sans-serif; }

  /* Cover */
  .cover { background:${C.ink}; color:#fff; min-height:940px; padding:64px 56px; display:flex; flex-direction:column; }
  .cover .brandbar { width:52px; height:6px; background:var(--accent); border-radius:3px; margin-bottom:40px; }
  .cover .eyebrow { letter-spacing:.22em; text-transform:uppercase; font-size:11px; color:var(--accent); font-weight:600; }
  .cover h1 { color:#fff; font-size:40px; line-height:1.1; margin:14px 0 8px; font-weight:700; }
  .cover .sub { color:#b9c2d4; font-size:15px; margin-bottom:auto; }
  .cover .cover-meta { border-top:1px solid #2a3a5c; padding-top:26px; margin-top:40px; }
  .cover-row { display:flex; padding:8px 0; border-bottom:1px solid #21314f; }
  .cover-k { width:150px; color:#8ea0c0; font-size:12px; text-transform:uppercase; letter-spacing:.05em; }
  .cover-v { color:#fff; font-weight:500; font-family:'Poppins',sans-serif; }
  .cover .gen { color:#7c8aa6; font-size:11px; margin-top:28px; }
  .cover .disclaimer { color:#66748f; font-size:10.5px; margin-top:10px; line-height:1.5; }

  /* Confidence banner */
  .confband { display:flex; gap:20px; align-items:center; background:var(--panel); border:1px solid var(--border);
    border-radius:12px; padding:20px 24px; margin-bottom:28px; }
  .conf-big { font-family:'Poppins',sans-serif; font-size:30px; font-weight:700; line-height:1; }
  .conf-cap { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .mixbar { flex:1; }
  .mixbar-track { height:10px; border-radius:6px; overflow:hidden; display:flex; margin-bottom:8px; }
  .mix-legend { display:flex; gap:16px; font-size:11px; color:var(--muted); }
  .mix-dot { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; vertical-align:middle; }

  /* Sections */
  .section { margin:26px 0; page-break-inside:auto; }
  .section-head { display:flex; align-items:center; justify-content:space-between; border-bottom:2px solid var(--border);
    padding-bottom:8px; margin-bottom:14px; }
  .section-head h2 { font-size:18px; font-weight:600; }
  .chips { display:flex; gap:5px; }
  .tl { font-size:10px; padding:2px 8px; border-radius:20px; border:1px solid; font-weight:600;
    font-family:'Inter',sans-serif; white-space:nowrap; }
  .unassessed { border:1px dashed var(--border); border-radius:8px; padding:14px; color:var(--muted); font-style:italic; }

  .site-block { background:var(--panel); border:1px solid var(--border); border-radius:10px; padding:14px 16px; margin-bottom:12px;
    page-break-inside:avoid; }
  .site-name { font-family:'Poppins',sans-serif; font-weight:600; color:var(--ink); margin-bottom:10px; font-size:13px; }
  .metric { display:grid; grid-template-columns:38% 1fr 64px; gap:12px; align-items:center; padding:7px 0;
    border-top:1px solid #eceff5; }
  .metric:first-child { border-top:0; }
  .metric-label > div:first-child { color:var(--ink); }
  .metric-sub { font-size:10.5px; color:var(--muted); margin-top:3px; display:flex; align-items:center; gap:6px; }
  .mnote { color:var(--muted); }
  .metric-right { text-align:right; font-family:'Poppins',sans-serif; font-size:15px; }
  .mval { font-weight:600; color:var(--ink); }

  .bar { height:7px; background:#e7ebf2; border-radius:4px; overflow:hidden; }
  .bar-fill { height:100%; border-radius:4px; }
  .pill { font-size:11px; padding:3px 10px; border-radius:20px; font-weight:600; text-transform:capitalize;
    font-family:'Inter',sans-serif; }
  .range-track { position:relative; height:8px; border-radius:5px;
    background:linear-gradient(90deg, ${C.go}66, ${C.caution}66, ${C.nogo}66); }
  .range-marker { position:absolute; top:-2px; width:2px; height:12px; background:var(--ink); }
  .range-labels { display:flex; justify-content:space-between; font-size:10.5px; color:var(--muted); margin-top:4px; }
  .range-med { color:var(--ink); font-weight:600; }

  /* Scorecards */
  .scorecard { border:1px solid var(--border); border-radius:10px; overflow:hidden; margin-bottom:14px; page-break-inside:avoid; }
  .sc-head { display:flex; justify-content:space-between; align-items:center; background:var(--panel); padding:12px 16px; }
  .sc-site { font-family:'Poppins',sans-serif; font-weight:600; color:var(--ink); }
  .sc-verdict { color:#fff; font-family:'Poppins',sans-serif; font-weight:600; font-size:12px; padding:5px 14px; border-radius:20px; }
  .sc-table { width:100%; border-collapse:collapse; }
  .sc-table td { padding:10px 16px; border-top:1px solid #eceff5; vertical-align:top; }
  .sc-crit > div:first-child { color:var(--ink); font-weight:500; }
  .sc-meta { font-size:10.5px; color:var(--muted); margin:3px 0; display:flex; align-items:center; gap:6px; }
  .sc-note { font-size:11px; color:var(--muted); }
  .sc-bar { width:200px; }
  .sc-score { font-family:'Poppins',sans-serif; font-weight:600; margin-left:8px; }

  .footer { border-top:1px solid var(--border); margin-top:34px; padding-top:14px; color:var(--muted); font-size:10.5px;
    display:flex; justify-content:space-between; }

  @media print {
    body { background:#fff; }
    .toolbar { display:none; }
    .sheet { box-shadow:none; margin:0; padding:0 8px; max-width:100%; }
    .cover { min-height:0; height:960px; padding:70px 60px; }
    .section { page-break-inside:auto; }
    @page { margin:14mm; }
  }
</style>
</head>
<body>
  <div class="toolbar">
    <span class="t-title">Site Intelligence Report — ${esc(report.brandName)}<span class="hint">Print or save as PDF: Ctrl/Cmd + P → “Save as PDF”</span></span>
    <button onclick="window.print()">Download / Print PDF</button>
  </div>

  <!-- COVER -->
  <div class="cover">
    <div class="brandbar"></div>
    <div class="eyebrow">Site Intelligence Report</div>
    <h1>${esc(report.brandName)}</h1>
    <div class="sub">${opts.runVertical ? esc(opts.runVertical) + ' · ' : ''}${opts.siteCount ? esc(opts.siteCount) + ' candidate site' + (opts.siteCount === 1 ? '' : 's') + ' · ' : ''}Franchise site analysis</div>
    <div class="cover-meta">
      ${coverRows || '<div class="cover-row"><span class="cover-v" style="color:#8ea0c0">Add client details on the report page to personalise this cover.</span></div>'}
    </div>
    <div class="gen">Generated ${esc(generated)}</div>
    <div class="disclaimer">Figures carry a Truth-Layer classification (Verified / Assumed / Projected). Projected and Assumed values are model- or estimate-based and should be validated before any commitment. This report supplements — it does not replace — professional due diligence.</div>
  </div>

  <div class="page"><div class="sheet">
    <!-- CONFIDENCE -->
    <div class="confband">
      <div>
        <div class="conf-cap">Overall confidence</div>
        <div class="conf-big" style="color:${CONF_COLOR[conf]}">${CONF_LABEL[conf]}</div>
      </div>
      <div class="mixbar">
        <div class="mixbar-track">
          <div style="width:${seg(mix.verified)};background:${C.verified}"></div>
          <div style="width:${seg(mix.assumed)};background:${C.assumed}"></div>
          <div style="width:${seg(mix.projected)};background:${C.projected}"></div>
        </div>
        <div class="mix-legend">
          <span><span class="mix-dot" style="background:${C.verified}"></span>${mix.verified} Verified</span>
          <span><span class="mix-dot" style="background:${C.assumed}"></span>${mix.assumed} Assumed</span>
          <span><span class="mix-dot" style="background:${C.projected}"></span>${mix.projected} Projected</span>
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
