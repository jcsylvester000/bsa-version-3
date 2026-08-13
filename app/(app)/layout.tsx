import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isUuid } from '@/lib/util/uuid';
import { LogoutButton } from '@/components/LogoutButton';
import { SidebarNav } from '@/components/SidebarNav';
import { OnboardingTour } from '@/components/OnboardingTour';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  // First-run tour: show once for a brand-new account (has_onboarded = false). We key
  // off the actual user row, not AUTH_MODE — a real registered account gets the tour
  // even while the mock demo logins are also enabled. A mock demo user has no matching
  // DB row, so the lookup returns null and the tour simply doesn't show for them.
  // Guard the lookup: a mock demo id (e.g. "mock-admin") isn't a UUID and would make
  // Postgres throw. Only query for a real UUID-keyed account.
  const u = isUuid(session.id)
    ? await prisma.appUser
        .findUnique({ where: { id: session.id }, select: { hasOnboarded: true } })
        .catch(() => null)
    : null;
  const showTour = u ? u.hasOnboarded === false : false;

  return (
    <div className="flex min-h-screen bg-ink-bg">
      {/* Left rail */}
      <aside className="hidden w-60 shrink-0 border-r border-ink-border bg-ink-panel-2 md:flex md:flex-col">
        <div className="flex items-center gap-2 px-5 py-4">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-ink-bg">G</div>
          <div>
            <p className="text-sm font-bold leading-none text-ink-text">BSA</p>
            <p className="text-[10px] uppercase tracking-wider text-ink-muted">Site Analysis</p>
          </div>
        </div>
        <SidebarNav />
        <div className="mt-auto border-t border-ink-border px-4 py-3">
          <Link href="/settings" className="block truncate text-xs text-ink-text hover:text-accent" title="Account settings">{session.email}</Link>
          <div className="mt-1 flex items-center justify-between">
            <span className="rounded-full bg-ink-hover px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">{session.role}</span>
            <div className="flex items-center gap-3">
              <Link href="/settings" className="text-[11px] text-ink-muted hover:text-accent">Settings</Link>
              <LogoutButton />
            </div>
          </div>
        </div>
      </aside>

      {/* Content */}
      <div className="flex-1">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-ink-border bg-ink-panel-2 px-4 py-3 md:hidden">
          <Link href="/runs" className="font-bold text-ink-text">BSA</Link>
          <LogoutButton />
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
      </div>

      <OnboardingTour show={showTour} />
    </div>
  );
}
