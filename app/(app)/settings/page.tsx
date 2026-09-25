import Link from 'next/link';
import { getSession } from '@/lib/auth/session';
import { getAccountCreatedAt } from '@/lib/services/account';
import { isMockUser } from '@/lib/auth/mockUsers';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';
import { manilaLongStamp } from '@/lib/util/manilaTime';

export const dynamic = 'force-dynamic';

/**
 * Account settings — profile read-out (identity, role, member-since) plus a working
 * change-password form. A registered user self-manages their credential here; demo
 * accounts see the profile but the password form is disabled (they have no DB row).
 */
export default async function SettingsPage() {
  const session = await getSession();
  if (!session) return null;

  const demo = isMockUser(session);
  const createdAt = await getAccountCreatedAt(session);

  // A bare-username account stores its login as "<name>@local"; show the friendly part.
  const displayName = session.email.endsWith('@local') ? session.email.replace(/@local$/, '') : session.email;
  // Demo accounts have no created-at row; show a meaningful label instead of a bare "—"
  // (which reads as broken/missing data to a viewer).
  const memberSince = createdAt
    ? manilaLongStamp(new Date(createdAt)).split(' at ')[0] // ICU-free (Netlify has no tz data)
    : 'Demo account';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex flex-col gap-1.5">
        <h1 className="text-h1">Settings</h1>
        <p className="text-body text-ink-muted">Your account and sign-in credentials.</p>
      </div>

      <section className="card p-6">
        <h2 className="font-body text-title">Account</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="stat-label">Username / email</dt>
            <dd className="mt-1 text-body text-ink-text">{displayName}</dd>
          </div>
          <div>
            <dt className="stat-label">Role</dt>
            <dd className="mt-1 text-body capitalize text-ink-text">{session.role}</dd>
          </div>
          <div>
            <dt className="stat-label">Member since</dt>
            <dd className="mt-1 text-body text-ink-text">{memberSince}</dd>
          </div>
          <div>
            <dt className="stat-label">Account type</dt>
            <dd className="mt-1 text-body text-ink-text">{demo ? 'Demo (read-only)' : 'Registered'}</dd>
          </div>
        </dl>
      </section>

      <section className="card mt-6 p-6">
        <h2 className="font-body text-title">Getting started</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-body text-ink-muted">
            Replay the guided walkthrough — intake, the Site Dashboard, the four module tabs and the Final Report.
          </p>
          <Link href="/runs?tour=1" className="btn-secondary shrink-0">
            Replay tour
          </Link>
        </div>
      </section>

      <section className="card mt-6 p-6">
        <h2 className="font-body text-title">Change password</h2>
        {demo ? (
          <p className="empty-state mt-3 text-body text-ink-muted">
            Demo accounts are login-only and can’t change a password. Register a real account to manage credentials.
          </p>
        ) : (
          <ChangePasswordForm />
        )}
      </section>
    </div>
  );
}
