/**
 * The Final Report model is shared by the screen (AnalysisTab) and the exported site PDF, so both carry
 * the same data. These cases pin the rows/figures a user sees, and that the PDF renders from them.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { buildSiteReportModel, siteReportMeta, payloadsFromRows } from '@/lib/modules/siteReportModel';
import { SAMPLE_PAYLOADS, SAMPLE_META } from '../fixtures/siteReportSample';

const model = () => buildSiteReportModel({ payloads: SAMPLE_PAYLOADS, verdict: 'go', meta: SAMPLE_META });

describe('buildSiteReportModel', () => {
  it('the composite band decides the call (F-07) and the hero meta is carried through', () => {
    const m = model();
    expect(m.summary.label).toBe('Proceed');
    expect(m.limited).toBe(false);
    expect(m.coverageText).toBe('4 of 4 modules');
    expect(m.meta.rank).toBe(1);
    expect(m.truthPct).toEqual({ verified: 0, assumed: 50, projected: 50 });
  });

  it('carries every module row the screen shows, each with its Truth Layer', () => {
    const m = model();
    const byKey = Object.fromEntries(m.modules.map((x) => [x.key, x]));
    expect(byKey.territory.status).toEqual({ tone: 'nogo', label: 'Redistributes existing sales' });
    expect(byKey.territory.lead).toMatch(/competitive saturation/);
    expect(byKey.territory.rows.map((r) => r.label)).toEqual([
      'Own-branch overlap', 'Competitive saturation', 'Est. monthly cannibalization', 'Competes with', 'Affected own outlets',
    ]);
    expect(byKey.territory.rows[1]).toEqual({ label: 'Competitive saturation', value: '71% · 4 direct + 67 adjacent', truth: 'projected' });
    expect(byKey.lease.status?.tone).toBe('muted'); // rent is a statement, never a status colour
    expect(byKey.lease.rows.find((r) => r.label.startsWith('BIR zonal'))?.value).toBe('Commercial Regular · ₱9,000–₱2,160,000/sqm');
    expect(byKey.daypart.rows.find((r) => r.label === 'Peak window')?.value).toBe('11:00–14:00 (office-led)');
    expect(byKey.whitespace.rows.map((r) => r.label)).toContain('#1 Pasong Tamo, Quezon City');
    expect(byKey.whitespace.rows.find((r) => r.label === "This site's cannibalization")?.value).toBe('92%');
  });

  it('headline figures per finding', () => {
    const m = model();
    expect(m.figures.Cannibalization).toEqual({ value: '₱0 / mo', truth: 'projected' });
    expect(m.figures['Demand window']).toEqual({ value: '74% in window', truth: 'projected' });
    expect(m.figures['White-space']?.value).toBe('5 areas');
    expect(m.figures['Lease position']?.value).toBe('median ₱1,650/sqm');
  });

  it('honest gap when a module did not run; limited hero only with no band and thin data', () => {
    const m = buildSiteReportModel({ payloads: { ...SAMPLE_PAYLOADS, territory: null, lease: null, daypart: null }, verdict: null });
    expect(m.modules[0].ran).toBe(false);
    expect(m.modules[0].emptyText).toMatch(/no stored result/);
    expect(m.limited).toBe(true);
  });

  it('siteReportMeta ranks like the dashboard and excludes the legacy analysis row from the truth mix', () => {
    const meta = siteReportMeta({
      site: { id: 'b', compositeScore: 66, analyzedAt: null },
      run: { confidence: 'low' },
      rows: [{ module: 'territory', truthLayer: 'projected' }, { module: 'lease', truthLayer: 'assumed' }, { module: 'analysis', truthLayer: 'verified' }],
      runSites: [{ id: 'a', compositeScore: 40 }, { id: 'b', compositeScore: 66 }, { id: 'c', compositeScore: null }],
    });
    expect(meta).toMatchObject({ composite: 66, rank: 1, total: 3, truthPct: { verified: 0, assumed: 50, projected: 50 } });
    expect(payloadsFromRows([{ module: 'lease', payload: { corridor: 'BGC' } }]).lease).toEqual({ corridor: 'BGC' });
  });
});

describe('site PDF', () => {
  it('renders the model to a real PDF (text, not a screenshot)', async () => {
    const { renderToBuffer } = await import('@react-pdf/renderer');
    const { AnalysisPdf } = await import('@/lib/pdf/AnalysisPdf');
    const el = React.createElement(AnalysisPdf, { model: model(), siteLabel: 'Proposed — BGC High Street', brand: 'BrewLab Tea', location: 'Taguig', generatedAt: 'September 28, 2026 at 3:42 PM' });
    const buf = await renderToBuffer(el as unknown as Parameters<typeof renderToBuffer>[0]);
    expect(Buffer.from(buf).subarray(0, 4).toString()).toBe('%PDF');
    expect(buf.length).toBeGreaterThan(5000);
  }, 30000);
});
