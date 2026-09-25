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

  // First-run tour (unchanged): only for a real UUID-keyed account that hasn't onboarded.
  const u = isUuid(session.id)
    ? await prisma.appUser
        .findUnique({ where: { id: session.id }, select: { hasOnboarded: true } })
        .catch(() => null)
    : null;
  const showTour = u ? u.hasOnboarded === false : false;

  return (
    <div className="flex min-h-screen bg-ink-bg">
      <a href="#main" className="btn-primary sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50">Skip to content</a>

      {/* Left rail (desktop) */}
      <aside className="sticky top-0 hidden h-screen w-[264px] shrink-0 border-r border-ink-border bg-ink-panel-2 md:flex md:flex-col">
        <div className="flex flex-col gap-2.5 px-5 pb-3.5 pt-[22px]">
          <GridLogo className="h-11 w-auto self-start" />
          <p className="overline text-xs tracking-[0.16em]">Business Site Analysis</p>
        </div>
        <SidebarNav />
        {/* Account block — stacked so nothing wraps mid-word ("Log / out") in the 248px rail. */}
        <div className="mt-auto flex flex-col gap-3 border-t border-ink-border px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Link href="/settings" className="link truncate text-label font-normal text-ink-text" title={session.email}>{session.email}</Link>
            <span className="self-start whitespace-nowrap rounded-full bg-ink-hover px-2.5 py-0.5 text-chip uppercase tracking-wide text-ink-muted">{session.role}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Link href="/settings" className="btn-secondary min-h-[40px] whitespace-nowrap px-3 text-label font-normal">Settings</Link>
            <LogoutButton className="btn-secondary min-h-[40px] whitespace-nowrap px-3 text-label font-normal" />
          </div>
        </div>
      </aside>

      {/* Content — fills the whole viewport beside the rail, with comfortable edge padding that grows
          on wide screens (it used to be capped at 1192px and hug the left edge). */}
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav email={session.email} role={session.role} />
        <main id="main" className="w-full px-4 py-6 sm:px-6 md:px-10 md:py-9 xl:px-14 2xl:px-20">{children}</main>
        {/* RA 9646 / broker-supplementation notice on every signed-in page — present but calm. */}
        <footer className="mt-auto w-full px-4 pb-7 sm:px-6 md:px-10 xl:px-14 2xl:px-20">
          <div className="notice-ra flex items-start gap-3">
            <span className="shrink-0 rounded-chip border border-ink-border px-1.5 py-0.5 text-chip text-ink-muted">RA 9646</span>
            <p>
              {BROKER_DISCLAIMER_SHORT}
              {/* Running build id (audit F-50) so the owner can confirm which deploy is live. */}
              <span className="ml-2 opacity-60">· build {process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'}</span>
            </p>
          </div>
        </footer>
      </div>

      <OnboardingTour show={showTour} />
    </div>
  );
}
