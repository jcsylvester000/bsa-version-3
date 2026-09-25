import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { prisma } from '@/lib/db/prisma';
import { isUuid } from '@/lib/util/uuid';
import { LogoutButton } from '@/components/LogoutButton';
import { GridLogo } from '@/components/GridLogo';
import { SidebarNav } from '@/components/SidebarNav';
import { MobileNav } from '@/components/MobileNav';
import { OnboardingTour } from '@/components/OnboardingTour';
import { BROKER_DISCLAIMER_SHORT } from '@/lib/truth/guardrailCopy';

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
        <div className="px-5 py-4">
          <GridLogo className="h-8 w-auto" />
          <p className="mt-2 text-[10px] uppercase tracking-[0.16em] text-ink-muted">Business Site Analysis</p>
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
          <div className="flex items-center gap-2">
            <MobileNav email={session.email} />
            <Link href="/runs" className="flex items-center">
              <GridLogo className="h-7 w-auto" />
            </Link>
          </div>
          <LogoutButton />
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        {/* RA 9646 / broker-supplementation notice on every signed-in page, plus the running build id. */}
        <footer className="mx-auto max-w-7xl px-6 pb-6 text-xs leading-relaxed text-ink-muted">
          {BROKER_DISCLAIMER_SHORT}
          <span className="ml-2 opacity-60">· build {process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'}</span>
        </footer>
      </div>

      <OnboardingTour show={showTour} />
    </div>
  );
}
