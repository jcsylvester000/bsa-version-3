/**
 * Render a composed report to a Markdown document (the stored artifact) and persist
 * it: write to object storage behind a signed URL, save the report row + pointer +
 * confidence. Postgres holds the pointer, not the blob.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { getStorage } from '@/lib/storage';
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

export interface PersistedReport {
  reportId: string;
  storageKey: string;
  confidence: string;
  markdown: string;
}

/** Render + store + save the report row. Returns the report id and storage key. */
export async function renderAndPersistReport(report: ComposedReport, generatedAtISO: string): Promise<PersistedReport> {
  const markdown = renderReportMarkdown(report, generatedAtISO);
  const storageKey = `reports/${report.runId}/site-intelligence.md`;

  await getStorage().put({ key: storageKey, body: markdown, contentType: 'text/markdown; charset=utf-8' });

  // Upsert the report row (one report per run).
  const existing = await prisma.report.findUnique({ where: { pipelineRunId: report.runId } });
  const saved = existing
    ? await prisma.report.update({
        where: { pipelineRunId: report.runId },
        data: { storageKey, format: 'pdf', confidence: report.confidence, generatedAt: new Date(generatedAtISO) },
      })
    : await prisma.report.create({
        data: {
          pipelineRunId: report.runId,
          storageKey,
          format: 'pdf',
          confidence: report.confidence,
          generatedAt: new Date(generatedAtISO),
        },
      });

  return { reportId: saved.id, storageKey, confidence: report.confidence, markdown };
}
