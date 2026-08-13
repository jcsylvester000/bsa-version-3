import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';

const renameSchema = z.object({ name: z.string().trim().min(1).max(120) });

/**
 * PATCH /api/runs/[id] — rename a run. Only the run's creator (or staff) may rename it,
 * enforced with the same `canAccessRun` boundary every read uses.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!isUuid(params.id)) return errors.notFound('Run');

  const body = await req.json().catch(() => null);
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  const run = await prisma.pipelineRun.findUnique({
    where: { id: params.id },
    select: { id: true, createdByUserId: true, franchisorId: true },
  });
  if (!run) return errors.notFound('Run');
  if (!canAccessRun(session, run)) return errors.forbidden();

  const updated = await prisma.pipelineRun.update({
    where: { id: params.id },
    data: { name: parsed.data.name },
    select: { id: true, name: true },
  });
  return ok({ run: updated });
}
