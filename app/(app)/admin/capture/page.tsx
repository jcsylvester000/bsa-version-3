import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { isAdmin } from '@/lib/auth/auth';
import { CaptureWorkbench } from '@/components/admin/CaptureWorkbench';
import { TruthLegend } from '@/components/ui/Chips';

export const dynamic = 'force-dynamic';

/**
 * Admin → Place Capture. Grid-navigator's POI capture, inside BSA: pull places for any area of the
 * Philippines from OpenStreetMap, import field sessions, add missing places by hand, review, and save
 * them to the shared places table every broker's analysis reads. Admins only (the API enforces it too).
 */
export default async function AdminCapturePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session)) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="overline">Admin</p>
        <h1 className="text-h1">Place Capture</h1>
        <p className="max-w-3xl text-body text-ink-muted">
          Add places for new areas so brokers&apos; site analyses have real surroundings to work with. Pull them from
          OpenStreetMap, import a Grid Navigator field session, or pin what is missing — then review and save.
          Nothing is shared until you save a batch.
        </p>
        <TruthLegend className="mt-1" />
      </div>
      <CaptureWorkbench />
    </div>
  );
}
