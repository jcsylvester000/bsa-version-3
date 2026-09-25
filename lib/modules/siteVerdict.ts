/**
 * Deterministic site recommendation — replaces the AI Analysis write-up.
 *
 * Reads the four module results that are already computed for a site and rolls them into a single
 * PROCEED / CAUTIOUS / NO-GO call, with a one-line headline, a short list of findings (keyword +
 * the data behind it), and machine keywords. Pure + client-safe, so the results page and the PDF
 * share ONE implementation and a unit test can pin the thresholds.
 *
 * Truth Layer discipline: every finding is carried straight from a module figure — nothing is
 * invented, and no price verdict is issued (lease is positioned against the corridor, never judged).
 * The three site-viability modules (Territory, Lease, Daypart) drive the call; White-Space is shown
 * as an opportunity note but does not move the verdict for THIS site.
 */

export type SiteClass = 'proceed' | 'cautious' | 'no_go';
export type Tone = 'go' | 'caution' | 'nogo' | 'muted';
export type DriverKey = 'territory' | 'lease' | 'daypart';

export interface SiteFinding {
  /** Short label ("Cannibalization", "Lease position", "Demand window", "White-space"). */
  keyword: string;
  /** The data behind it, human-readable. */
  detail: string;
  tone: Tone;
}

export interface SiteSummary {
  classification: SiteClass;
  /** Display label for the badge. */
  label: string;
  tone: 'go' | 'caution' | 'nogo';
  /** One-sentence rationale assembled from the drivers. */
  headline: string;
  findings: SiteFinding[];
  /** Compact machine tags (e.g. "redistributes", "above-market", "weak-window"). */
  keywords: string[];
  /** How many of the three site-viability modules have data. */
  coverage: number;
}

/** Minimal shapes we read — loose on purpose so this never couples to the full payload types. */
export interface SummaryInput {
  territory?: { verdict?: string | null; totalCannibalizedPhp?: number | null; competitiveSaturationPct?: number | null } | null;
  lease?: { verdict?: string | null; corridor?: string | null } | null;
  daypart?: { windowMatchPct?: number | null; noCatchmentData?: boolean | null } | null;
  whitespace?: { recommendations?: Array<{ verdict?: string | null }> | null } | null;
}

const CLASS_LABEL: Record<SiteClass, { label: string; tone: 'go' | 'caution' | 'nogo' }> = {
  proceed: { label: 'Proceed', tone: 'go' },
  cautious: { label: 'Proceed with caution', tone: 'caution' },
  no_go: { label: 'No-Go', tone: 'nogo' },
};

const toneValue = (t: Tone): number => (t === 'go' ? 1 : t === 'nogo' ? -1 : 0);
const peso = (n: number): string => `₱${Math.round(n).toLocaleString('en-US')}`;

/** Territory tone + finding from its verdict (adds → go, mixed → caution, redistributes → no-go). */
function territoryFinding(t: SummaryInput['territory']): SiteFinding | null {
  if (!t || !t.verdict) return null;
  const v = t.verdict;
  const risk = typeof t.totalCannibalizedPhp === 'number' && t.totalCannibalizedPhp > 0 ? ` · ${peso(t.totalCannibalizedPhp)}/mo of own sales at risk` : '';
  if (v === 'adds') return { keyword: 'Cannibalization', detail: `Adds sales — little overlap with your own branches${risk}`, tone: 'go' };
  if (v === 'redistributes') return { keyword: 'Cannibalization', detail: `Redistributes existing sales${risk}`, tone: 'nogo' };
  return { keyword: 'Cannibalization', detail: `Mixed — some redistribution of own sales${risk}`, tone: 'caution' };
}

/** Lease tone + finding from its position vs the corridor (never a price verdict). */
function leaseFinding(l: SummaryInput['lease']): SiteFinding | null {
  if (!l || !l.verdict) return null;
  const corr = l.corridor ? ` in ${l.corridor}` : '';
  switch (l.verdict) {
    case 'below_market': return { keyword: 'Lease position', detail: `Asking rent sits below the corridor${corr}`, tone: 'go' };
    case 'above_market': return { keyword: 'Lease position', detail: `Asking rent sits above the corridor${corr}`, tone: 'caution' };
    case 'at_market': return { keyword: 'Lease position', detail: `Asking rent is in line with the corridor${corr}`, tone: 'caution' };
    case 'corridor_benchmark': return { keyword: 'Lease position', detail: `Corridor rent benchmark available${corr} — enter an asking rent to position it`, tone: 'caution' };
    default: return { keyword: 'Lease position', detail: 'Not enough comparable leases to position the rent', tone: 'muted' };
  }
}

/** Daypart tone + finding from the window-match figure (same thresholds as the tab). */
function daypartFinding(d: SummaryInput['daypart']): SiteFinding | null {
  if (!d) return null;
  if (d.noCatchmentData) return { keyword: 'Demand window', detail: 'No catchment data to derive the demand window', tone: 'muted' };
  const w = d.windowMatchPct;
  if (typeof w !== 'number') return null;
  if (w >= 60) return { keyword: 'Demand window', detail: `Strong window match (${Math.round(w)}%)`, tone: 'go' };
  if (w >= 40) return { keyword: 'Demand window', detail: `Partial window match (${Math.round(w)}%)`, tone: 'caution' };
  return { keyword: 'Demand window', detail: `Weak window match (${Math.round(w)}%)`, tone: 'nogo' };
}

/** White-space opportunity note (informational — does not move THIS site's verdict). */
function whitespaceFinding(w: SummaryInput['whitespace']): SiteFinding | null {
  const recs = w?.recommendations;
  if (!recs || recs.length === 0) return null;
  const open = recs.filter((r) => r.verdict === 'open').length;
  return {
    keyword: 'White-space',
    detail: open > 0 ? `${open} open barangay${open === 1 ? '' : 's'} nearby worth a look` : `${recs.length} nearby area${recs.length === 1 ? '' : 's'} scanned for white-space`,
    tone: 'muted',
  };
}

const KEYWORD: Record<string, string> = {
  'Adds sales': 'adds-sales',
  redistributes: 'redistributes',
  mixed: 'mixed-cannibalization',
  below_market: 'below-market',
  above_market: 'above-market',
  at_market: 'at-market',
};

/**
 * Roll the modules into a single call.
 * @param input   the four module payloads (loose shapes)
 * @param isPrimary optional — marks which modules are decision-critical for this vertical; a primary
 *                  module reading No-Go blocks the site. When omitted, any module can block.
 */
export function summariseSite(input: SummaryInput, isPrimary?: (m: DriverKey) => boolean): SiteSummary {
  const drivers: Array<{ key: DriverKey; finding: SiteFinding }> = [];
  const tf = territoryFinding(input.territory); if (tf) drivers.push({ key: 'territory', finding: tf });
  const lf = leaseFinding(input.lease); if (lf) drivers.push({ key: 'lease', finding: lf });
  const df = daypartFinding(input.daypart); if (df) drivers.push({ key: 'daypart', finding: df });

  const rated = drivers.filter((d) => d.finding.tone !== 'muted');
  const coverage = rated.length;
  const prim = (k: DriverKey) => (isPrimary ? isPrimary(k) : true);

  const nogos = rated.filter((d) => d.finding.tone === 'nogo');
  const gos = rated.filter((d) => d.finding.tone === 'go');
  const cautions = rated.filter((d) => d.finding.tone === 'caution');
  const score = rated.reduce((s, d) => s + toneValue(d.finding.tone) * (prim(d.key) ? 2 : 1), 0);
  const primaryNoGo = nogos.some((d) => prim(d.key));

  let classification: SiteClass;
  if (coverage === 0) {
    classification = 'cautious';
  } else if (primaryNoGo || nogos.length >= 2) {
    classification = 'no_go';
  } else if (coverage >= 2 && nogos.length === 0 && score >= 2 && gos.length >= cautions.length) {
    classification = 'proceed';
  } else {
    classification = 'cautious';
  }

  const meta = CLASS_LABEL[classification];

  // Headline: name the drivers that justify the call.
  const positives = gos.map((d) => d.finding.detail.replace(/ ·.*$/, '').toLowerCase());
  const negatives = [...nogos, ...cautions].map((d) => d.finding.detail.replace(/ ·.*$/, '').toLowerCase());
  let headline: string;
  if (coverage === 0) {
    headline = 'Not enough module data yet to make a call — run the site’s modules first.';
  } else if (classification === 'proceed') {
    headline = `Proceed — ${positives.join('; ')}${cautions.length ? `; watch: ${negatives.join('; ')}` : ''}.`;
  } else if (classification === 'no_go') {
    headline = `No-Go — ${(nogos.length ? nogos : cautions).map((d) => d.finding.detail.replace(/ ·.*$/, '').toLowerCase()).join('; ')}.`;
  } else {
    headline = `Proceed with caution — ${negatives.join('; ') || 'signals are mixed or evidence is thin'}.`;
  }

  const findings = [...drivers.map((d) => d.finding), whitespaceFinding(input.whitespace)].filter(Boolean) as SiteFinding[];

  const keywords: string[] = [];
  if (input.territory?.verdict) keywords.push(KEYWORD[input.territory.verdict] ?? input.territory.verdict);
  if (input.lease?.verdict) keywords.push(KEYWORD[input.lease.verdict] ?? input.lease.verdict);
  if (df && df.tone !== 'muted') keywords.push(df.tone === 'go' ? 'strong-window' : df.tone === 'caution' ? 'partial-window' : 'weak-window');

  return { classification, label: meta.label, tone: meta.tone, headline, findings, keywords, coverage };
}

/** Compose the summary into plain paragraphs (for the PDF, which takes narrative text). */
export function summaryToText(s: SiteSummary): string {
  const lines = [`Recommendation: ${s.label}.`, s.headline, '', 'Findings:'];
  for (const f of s.findings) lines.push(`• ${f.keyword}: ${f.detail}`);
  if (s.keywords.length) { lines.push('', `Keywords: ${s.keywords.join(', ')}`); }
  return lines.join('\n');
}
