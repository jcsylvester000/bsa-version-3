import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { isUuid } from '@/lib/util/uuid';
import { ok, errors } from '@/lib/api/respond';
import { prefillFromRequirements, type FranchiseRequirements } from '@/lib/modules/franchiseTemplate';

/**
 * GET /api/franchisors/[id] — a brand's franchise requirements template (if any) plus
 * the intake prefill derived from it. The wizard uses this to offer a
 * "Use [brand]'s franchise template" auto-fill. All from the DB; no Google calls.
 *
 * Access: any signed-in user. This is intentional — franchise requirement templates
 * (fee, investment, footprint, ROI benchmarks) are SHARED reference/catalog data, the
 * same catalog every user picks a brand from. The select below is deliberately limited
 * to brand identity + the requirements template; it exposes no runs, intakes, outlets,
 * or any user-private data, so there is nothing here to scope per-tenant.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!isUuid(params.id)) return errors.notFound('Franchisor'); // guard: non-UUID → 404, not a DB 500

  const franchisor = await prisma.franchisor.findUnique({
    where: { id: params.id },
    select: { id: true, brandName: true, sector: true, subCategory: true, requirements: true },
  });
  if (!franchisor) return errors.notFound('Franchisor');

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
