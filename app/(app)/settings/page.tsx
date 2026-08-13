import Link from 'next/link';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isUuid } from '@/lib/util/uuid';
import { isMockUser } from '@/lib/auth/mockUsers';
import { ChangePasswordForm } from '@/components/ChangePasswordForm';

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
  const row = isUuid(session.id)
    ? await prisma.appUser
        .findUnique({ where: { id: session.id }, select: { createdAt: true } })
        .catch(() => null)
    : null;

  // A bare-username account stores its login as "<name>@local"; show the friendly part.
  const displayName = session.email.endsWith('@local') ? session.email.replace(/@local$/, '') : session.email;
  // Demo accounts have no created-at row; show a meaningful label instead of a bare "—"
  // (which reads as broken/missing data to a viewer).
  const memberSince = row?.createdAt
    ? new Date(row.createdAt).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
    : 'Demo account';

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink-text">Account settings</h1>
        <p className="text-sm text-ink-muted">Your profile and sign-in credentials.</p>
      </div>

      <section className="card p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Profile</h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Username / email</dt>
            <dd className="mt-1 text-sm text-ink-text">{displayName}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Role</dt>
            <dd className="mt-1 text-sm capitalize text-ink-text">{session.role}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Member since</dt>
            <dd className="mt-1 text-sm text-ink-text">{memberSince}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-ink-muted">Account type</dt>
            <dd className="mt-1 text-sm text-ink-text">{demo ? 'Demo (read-only)' : 'Registered'}</dd>
          </div>
        </dl>
      </section>

      <section className="card mt-6 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Getting started</h2>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-text/85">
            Replay the guided walkthrough of the four screens you&apos;ll use most — intake,
            dashboard, the Intelligence modules, and the site report.
          </p>
          <Link href="/runs?tour=1" className="btn-accent shrink-0 text-center text-sm">
            Replay tour
          </Link>
        </div>
      </section>

      <section className="card mt-6 p-6">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Change password</h2>
        {demo ? (
          <p className="mt-3 rounded-lg border border-dashed border-ink-border p-4 text-sm text-ink-muted">
            Demo accounts are login-only and can’t change a password. Register a real account to manage credentials.
          </p>
        ) : (
          <ChangePasswordForm />
        )}
      </section>
    </div>
  );
}
