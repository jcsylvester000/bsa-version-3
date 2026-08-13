import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { isUuid } from '@/lib/util/uuid';
import { ok, errors } from '@/lib/api/respond';

/**
 * POST /api/auth/onboarding — mark the signed-in user as having finished the first-run
 * guided tour, so it never auto-plays again. Called by the OnboardingTour client
 * component when the user reaches the end or clicks "Skip tour".
 *
 * We always attempt the DB write and key off the real user row (not AUTH_MODE). A mock
 * demo user has no matching row, so the update simply no-ops — but a real registered
 * account gets its flag persisted even while mock logins are also enabled.
 */
export async function POST(_req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  // Only a real UUID-keyed account has a row to update. A mock demo id would make Postgres
  // throw on the UUID parse, so skip the write entirely for those.
  if (isUuid(session.id)) {
    await prisma.appUser
      .update({ where: { id: session.id }, data: { hasOnboarded: true } })
      .catch(() => null); // tolerate a missing row (legacy user) without failing
  }

  return ok({ onboarded: true });
}
