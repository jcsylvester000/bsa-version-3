import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { isMockUser } from '@/lib/auth/mockUsers';
import { safeQuery } from '@/lib/db/safeQuery';
import { DEMO_RUN_ID } from '@/lib/mock/mockCompute';
import { SteppedIntakeWizard } from '@/components/SteppedIntakeWizard';

export const dynamic = 'force-dynamic';

export default async function IntakePage({ searchParams }: { searchParams: { edit?: string } }) {
  const session = await getSession();
  const editIntakeId = searchParams.edit ?? null;

  // Brand list for the intake dropdown. Everyone can pick from the SHARED catalog
  // (brands with no owning user) so a brand-new franchisor account can start an intake
  // immediately; a user who owns a private brand also sees theirs. Staff see all.
  const getFranchisors = () =>
    session!.role === 'admin' || session!.role === 'analyst'
      ? prisma.franchisor.findMany({ select: { id: true, brandName: true }, orderBy: { brandName: 'asc' } })
      : prisma.franchisor.findMany({
          where: {
            OR: [
              { users: { none: {} } }, // shared catalog — available to any user
              ...(session!.franchisorId ? [{ id: session!.franchisorId }] : []), // their own private brand
            ],
          },
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
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink-text">{editIntakeId ? 'Edit & rerun' : 'New Intake'}</h1>
        <p className="text-sm text-ink-muted">
          {editIntakeId
            ? 'Your previous inputs are loaded — change anything and submit to create a new version.'
            : 'Four quick steps: pick the vertical, add your brief, your outlets, and the candidate sites.'}
        </p>
      </div>
      {franchisors.length === 0 && !usingMock && !editIntakeId ? (
        <div className="card p-8 text-center text-ink-muted">
          No franchisor on file yet. Create one before starting an intake.
        </div>
      ) : (
        <SteppedIntakeWizard franchisors={franchisors} mockMode={usingMock} mockRunId={DEMO_RUN_ID} editIntakeId={editIntakeId} />
      )}
    </div>
  );
}
