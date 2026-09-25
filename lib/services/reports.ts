/**
 * Reports service (F-47). One authorized data path for the run-level report view.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { canAccessRun, type SessionUser } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import type { Confidence } from '@/lib/truth/truthLayer';

export type ReportForView =
  | { kind: 'ok'; run: { id: string; brandName: string }; existing: { confidence: Confidence } | null }
  | { kind: 'not_uuid' | 'not_found' | 'forbidden' };

export async function getReportForView(session: SessionUser | null, runId: string): Promise<ReportForView> {
  if (!isUuid(runId)) return { kind: 'not_uuid' };
  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    include: { franchisor: { select: { brandName: true } }, report: true },
  });
  if (!run) return { kind: 'not_found' };
  if (!session || !canAccessRun(session, run)) return { kind: 'forbidden' };
  // Reports are built on demand (no stored file) — the row only records that one was generated.
  const existing = run.report?.confidence ? { confidence: run.report.confidence as Confidence } : null;
  return { kind: 'ok', run: { id: run.id, brandName: run.franchisor.brandName }, existing };
}
