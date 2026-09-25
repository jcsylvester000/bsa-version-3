import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { visibleFranchisorWhere } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { safeQuery } from '@/lib/db/safeQuery';
import { DEMO_RUN_ID } from '@/lib/mock/mockCompute';
import { SteppedIntakeWizard } from '@/components/SteppedIntakeWizard';

export const dynamic = 'force-dynamic';

export default async function IntakePage({ searchParams }: { searchParams: { edit?: string; brand?: string } }) {
  const session = await getSession();
  const editIntakeId = searchParams.edit ?? null;
  // From Franchise Screening. Only a hint: the wizard matches it against the brands this user can see.
  const initialBrand = (searchParams.brand ?? '').slice(0, 120) || null;

  // Brand list for the intake dropdown — the same visibility rule as /api/franchisors
  // (shared catalog + brands the user created + their own client brand; staff see all).
  const getFranchisors = () =>
    prisma.franchisor.findMany({
      where: visibleFranchisorWhere(session!),
      select: { id: true, brandName: true },
      orderBy: { brandName: 'asc' },
    });

  const { data: dbFranchisors, dbDown } = await safeQuery(getFranchisors, [] as Array<{ id: string; brandName: string }>);
  const franchisors = dbFranchisors;
  // Only the built-in demo user runs the wizard in mock mode. Real accounts always
  // submit real intakes to the DB (even if the catalog momentarily failed to load).
  const usingMock = isMockUser(session) && (dbDown || dbFranchisors.length === 0);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-1.5">
        <h1 className="text-h1">{editIntakeId ? 'Edit & rerun' : 'New Intake'}</h1>
        <p className="text-body text-ink-muted">
          {editIntakeId
            ? 'Your previous inputs are loaded — change anything and submit to create a new version.'
            : 'Four quick steps: pick the vertical, add your brief, your outlets, and the candidate sites.'}
        </p>
      </div>
      {franchisors.length === 0 && !usingMock && !editIntakeId ? (
        <div className="empty-state">
          <p className="text-title">No brands on file yet</p>
          <p className="text-body text-ink-muted">Create a franchise brand before starting an intake.</p>
        </div>
      ) : (
        <SteppedIntakeWizard franchisors={franchisors} mockMode={usingMock} mockRunId={DEMO_RUN_ID} editIntakeId={editIntakeId} initialBrand={initialBrand} />
      )}
    </div>
  );
}
