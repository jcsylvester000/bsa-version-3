'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SidebarNav } from '@/components/SidebarNav';
import { GridLogo } from '@/components/GridLogo';
import { LogoutButton } from '@/components/LogoutButton';

/**
 * Mobile navigation (audit F-32). Below the md breakpoint the left rail is hidden, which used to
 * leave phones with no way to reach Franchise Screening, New Intake or Settings. This adds a
 * hamburger button in the mobile top bar that opens a slide-over drawer with the same SidebarNav
 * items plus Settings and Logout. Closes on route change, on the backdrop, and on Escape.
 */
export function MobileNav({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close when the route changes (a nav item was tapped).
  useEffect(() => { setOpen(false); }, [pathname]);
  // Close on Escape, and lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="rounded-lg p-2 text-ink-text hover:bg-ink-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {/* Hamburger icon */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} aria-hidden="true" />
          {/* Panel */}
          <nav aria-label="Main menu" className="absolute inset-y-0 left-0 flex w-72 max-w-[85%] flex-col border-r border-ink-border bg-ink-panel-2 shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4">
              <GridLogo className="h-7 w-auto" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-lg p-1.5 text-ink-muted hover:bg-ink-hover hover:text-ink-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
                </svg>
              </button>
            </div>
            <SidebarNav />
            <div className="mt-auto border-t border-ink-border px-4 py-3">
              <Link href="/settings" className="block truncate text-sm text-ink-text hover:text-accent">{email}</Link>
              <div className="mt-2 flex items-center gap-4">
                <Link href="/settings" className="text-xs text-ink-muted hover:text-accent">Settings</Link>
                <LogoutButton />
              </div>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
