import { notFound, redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { isAdmin } from '@/lib/auth/auth';
import { CoverageMonitor } from '@/components/admin/CoverageMonitor';

export const dynamic = 'force-dynamic';

/**
 * Admin → Capture Coverage. Where BSA already has places (and how fresh), the log of every saved
 * capture, and the retry queue of areas OpenStreetMap did not return completely — so admins capture
 * the gaps instead of re-scanning the same spot. Admins only (the API enforces it too).
 */
export default async function AdminCoveragePage() {
  const session = await getSession();
  if (!session) redirect('/login');
  if (!isAdmin(session)) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="overline">Admin</p>
        <h1 className="text-h1">Capture Coverage</h1>
        <p className="max-w-3xl text-body text-ink-muted">
          Everything captured so far, on one map. Green areas are covered for 90 days and Place Capture skips them;
          grey areas are due for a re-capture; red dashed areas are in the <a className="link" href="#retry">retry queue</a> because
          OpenStreetMap did not return them completely. Pick a gap and capture it — not the same spot twice.
          <a className="link" href="#demand">User demand</a> shows what users searched for and where they placed intake sites, and the{' '}
          <a className="link" href="#autofill">automatic back-fill</a> collects place data for those areas on its own.
        </p>
      </div>
      <CoverageMonitor />
    </div>
  );
}
