/**
 * Run-report helpers: a deterministic Markdown rendering (used by tests / future export) and
 * the report-row recorder. Reports are generated on demand — nothing is written to storage.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { TRUTH_META, CONFIDENCE_META } from '@/lib/truth/truthLayer';
import type { ComposedReport } from './reportComposer';

/** Deterministic Markdown from the composed sections. */
export function renderReportMarkdown(report: ComposedReport, generatedAtISO: string): string {
  const conf = CONFIDENCE_META[report.confidence];
  const mix = report.truthLayerMix;
  const lines: string[] = [];

  lines.push(`# Site Intelligence Report — ${report.brandName}`);
  lines.push('');
  lines.push('_Business Site Analysis · Grid Property Ventures_');
  lines.push('');
  lines.push(`**Confidence: ${conf.label}** — ${conf.meaning}`);
  lines.push('');
  lines.push(
    `Truth Layer mix: ${mix.verified} Verified · ${mix.assumed} Assumed · ${mix.projected} Projected.` +
      (report.onGroundCheckFlagged ? ' An on-ground check is advised where flagged.' : ''),
  );
  lines.push('');
  lines.push('> BSA sharpens the shortlist and flags the risks; the broker still closes the deal.');
  lines.push('');
  lines.push('---');
  lines.push('');

  for (const s of report.sections) {
    lines.push(`## ${s.number}. ${s.title}`);
    lines.push('');
    if (!s.assessed) {
      lines.push(`_${s.text}_`);
      lines.push('');
      continue;
    }
    // Truth Layer summary chips for the section.
    const uniq = Array.from(new Set(s.truthLayers));
    if (uniq.length) {
      lines.push(`Truth Layer: ${uniq.map((l) => TRUTH_META[l].label).join(' · ')}`);
      lines.push('');
    }
    lines.push(s.text.trim());
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_Generated ${generatedAtISO}. ${report.generatedAtNote}_`);
  lines.push('');
  return lines.join('\n');
}

export interface RecordedReport {
  reportId: string;
  confidence: string;
}

/**
 * Record that a run report was generated (one row per run: confidence + timestamp). The report
 * itself is ALWAYS rebuilt on demand from the database (GET /api/reports/full renders the branded
 * HTML; the Analysis PDF renders per site) — no file is written. Batch 5 decision: Netlify's
 * serverless disk is temporary, so stored files + signed links broke; on-demand needs no bucket.
 * `storage_key` stays NULL. lib/storage (+ /api/files) remains for a future S3/R2 adapter.
 */
export async function recordReport(report: ComposedReport, generatedAtISO: string): Promise<RecordedReport> {
  const data = { storageKey: null, format: 'pdf' as const, confidence: report.confidence, generatedAt: new Date(generatedAtISO) };
  const saved = await prisma.report.upsert({
    where: { pipelineRunId: report.runId },
    update: data,
    create: { pipelineRunId: report.runId, ...data },
  });
  return { reportId: saved.id, confidence: report.confidence };
}
