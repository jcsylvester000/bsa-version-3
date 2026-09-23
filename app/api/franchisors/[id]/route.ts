import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canSeeFranchisor } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, errors } from '@/lib/api/respond';
import { prefillFromRequirements, type FranchiseRequirements } from '@/lib/modules/franchiseTemplate';

/**
 * GET /api/franchisors/[id] — a brand's franchise requirements template (if any) plus
 * the intake prefill derived from it. The wizard uses this to offer a
 * "Use [brand]'s franchise template" auto-fill. All from the DB; no Google calls.
 *
 * Access: shared-catalog brands are readable by any signed-in user (their templates are
 * reference data). A private brand — owned by a client, or created by a user — is only
 * visible to that owner/creator and Grid staff (canSeeFranchisor).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!isUuid(params.id)) return errors.notFound('Franchisor'); // guard: non-UUID → 404, not a DB 500

  const franchisor = await prisma.franchisor.findUnique({
    where: { id: params.id },
    select: {
      id: true, brandName: true, sector: true, subCategory: true, requirements: true,
      createdByUserId: true, _count: { select: { users: true } },
    },
  });
  // Brand privacy: a brand another user created / owns answers 404 (not 403) so its
  // existence isn't confirmed to outsiders.
  if (
    !franchisor ||
    !canSeeFranchisor(session, { id: franchisor.id, createdByUserId: franchisor.createdByUserId, ownerCount: franchisor._count.users })
  ) {
    return errors.notFound('Franchisor');
  }

  const requirements = (franchisor.requirements ?? null) as FranchiseRequirements | null;
  const prefill = requirements ? prefillFromRequirements(requirements) : null;

  return ok({
    id: franchisor.id,
    brandName: franchisor.brandName,
    hasTemplate: requirements != null,
    requirements,
    prefill,
  });
}
