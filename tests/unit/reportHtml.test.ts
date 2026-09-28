/**
 * Downloadable full report (design v2, batch 10): print button works under the nonce CSP,
 * rent is never coloured good/bad, statuses are icon + word, user text is escaped.
 */
import { describe, it, expect } from 'vitest';
import { renderReportHtml } from '@/lib/modules/reportHtml';

type Args = Parameters<typeof renderReportHtml>;
const report = {
  brandName: 'Test <Brand>',
  confidence: 'med',
  truthLayerMix: { verified: 2, assumed: 1, projected: 1 },
  sections: [
    {
      id: 'lease', number: 6, title: 'Lease', text: '', truthLayers: ['assumed'], grounded: [], assessed: true,
      metrics: [
        { siteLabel: 'Site A', label: 'Base rent vs corridor', score: 90, verdict: 'above_market', truthLayer: 'assumed', higherIsBetter: false, neutral: true },
        { siteLabel: 'Site A', label: 'Max trade-area overlap', score: 90, verdict: 'redistributes', truthLayer: 'projected', higherIsBetter: false },
      ],
    },
    { id: 'x', number: 7, title: 'Mall', text: '', truthLayers: [], grounded: [], assessed: false, metrics: [] },
  ],
} as unknown as Args[0];
const scorecards = [
  {
    siteLabel: 'Site A', composite: 58, band: 'caution', truthLayer: 'assumed',
    criteria: [{ key: 'lease', label: 'Lease value vs corridor', score: 10, weight: 0.2, truthLayer: 'assumed', note: '' }],
  },
] as unknown as Args[1];
const opts = { generatedAtISO: '2026-09-28T02:00:00Z', siteCount: 1 };

describe('renderReportHtml', () => {
  it('never uses an inline onclick (blocked by the CSP); wires the print button with the nonce', () => {
    const html = renderReportHtml(report, scorecards, {}, { ...opts, nonce: 'abc123==' });
    expect(html).not.toMatch(/onclick=/i);
    expect(html).toContain('<script nonce="abc123==">');
    expect(html).toContain('id="print-btn"');
  });
  it('omits the button (keeps the Ctrl/Cmd+P hint) without a valid nonce', () => {
    const html = renderReportHtml(report, scorecards, {}, { ...opts, nonce: '"><script>' });
    expect(html).not.toContain('<script');
    expect(html).toContain('Ctrl/Cmd + P');
  });
  it('draws rent in the neutral colour and names the position, not a judgement', () => {
    const html = renderReportHtml(report, scorecards, {}, opts);
    const leaseRow = html.slice(html.indexOf('Base rent vs corridor'), html.indexOf('Max trade-area overlap'));
    expect(leaseRow).toContain('#7A869B'); // neutral bar
    expect(leaseRow).not.toContain('#B3261E'); // never the No-Go red
    expect(leaseRow).toContain('Above corridor median');
    const card = html.slice(html.indexOf('Lease value vs corridor'));
    expect(card).toContain('#7A869B');
  });
  it('keeps real statuses as icon + word and escapes user text', () => {
    const html = renderReportHtml(report, scorecards, { preparedFor: '<img src=x onerror=alert(1)>' }, opts);
    expect(html).toContain('✕</span> Redistributes');
    expect(html).toContain('Proceed with caution');
    expect(html).toContain('Not assessed for this run');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('Test &lt;Brand&gt;');
  });
});
