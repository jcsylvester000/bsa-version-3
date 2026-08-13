import { describe, it, expect } from 'vitest';
import { renderReportMarkdown } from '@/lib/modules/reportRender';
import { REPORT_SECTIONS } from '@/lib/modules/reportSections';
import type { ComposedReport } from '@/lib/modules/reportComposer';

function fakeReport(overrides: Partial<ComposedReport> = {}): ComposedReport {
  return {
    runId: 'run-1',
    brandName: 'Macao Imperial Tea',
    confidence: 'med',
    onGroundCheckFlagged: false,
    truthLayerMix: { verified: 3, assumed: 2, projected: 1 },
    generatedAtNote: 'note',
    sections: [
      { id: 'executive_summary', number: 1, title: 'Executive Summary', text: 'Site adds sales.', truthLayers: ['verified'], grounded: [], assessed: true, metrics: [] },
      { id: 'competition', number: 4, title: 'Competition', text: 'Not assessed for this run.', truthLayers: [], grounded: [], assessed: false, metrics: [] },
    ],
    ...overrides,
  };
}

describe('REPORT_SECTIONS', () => {
  it('has nine sections numbered 1..9', () => {
    expect(REPORT_SECTIONS).toHaveLength(9);
    expect(REPORT_SECTIONS.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it('includes territory and financial/lease sections', () => {
    const titles = REPORT_SECTIONS.map((s) => s.title.toLowerCase()).join(' ');
    expect(titles).toContain('territory');
    expect(titles).toContain('financial');
    expect(titles).toContain('confidence');
  });
});

describe('renderReportMarkdown', () => {
  const md = renderReportMarkdown(fakeReport(), '2026-08-03T00:00:00.000Z');

  it('renders the brand title and confidence', () => {
    expect(md).toContain('# Site Intelligence Report — Macao Imperial Tea');
    expect(md).toContain('**Confidence: Medium**');
  });

  it('renders the Truth Layer mix', () => {
    expect(md).toContain('3 Verified · 2 Assumed · 1 Projected');
  });

  it('keeps the broker-supplementation framing', () => {
    expect(md.toLowerCase()).toContain('broker still closes the deal');
  });

  it('renders an unassessed section as italic, not invented content', () => {
    expect(md).toContain('_Not assessed for this run._');
  });

  it('stamps the generation time', () => {
    expect(md).toContain('2026-08-03T00:00:00.000Z');
  });

  it('adds an on-ground-check note when flagged', () => {
    const flagged = renderReportMarkdown(fakeReport({ onGroundCheckFlagged: true }), '2026-08-03T00:00:00.000Z');
    expect(flagged.toLowerCase()).toContain('on-ground check is advised');
  });
});
