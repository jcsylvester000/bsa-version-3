/**
 * Audit log — governance requirement from intake Section K. Sensitive actions
 * (intake submit, run start, report access) write a row here. Best-effort: an
 * audit write must never block the user action, but failures are surfaced in logs.
 */
import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

export async function audit(params: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId ?? null,
        meta: (params.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (err) {
    console.error('[audit] failed to write audit row', { action: params.action, err });
  }
}
