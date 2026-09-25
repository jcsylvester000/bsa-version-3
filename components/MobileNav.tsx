'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { GridLogo } from '@/components/GridLogo';
import { SidebarNav } from '@/components/SidebarNav';
import { LogoutButton } from '@/components/LogoutButton';

/** Mobile top bar + slide-in drawer (native <dialog> — focus trap + Esc for free, no new dependency). */
export function MobileNav({ email, role }: { email: string; role: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <header className="flex h-[60px] items-center justify-between border-b border-ink-border bg-ink-panel-2 pl-4 pr-2 md:hidden">
        <Link href="/runs" className="focus-ring flex items-center rounded" aria-label="Site Dashboard">
          <GridLogo className="h-[34px] w-auto" />
        </Link>
        <button type="button" onClick={() => setOpen(true)} className="btn px-0 min-w-tap text-2xl" aria-label="Open menu" aria-expanded={open}>
          ☰
        </button>
      </header>

      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === ref.current) setOpen(false); }}
        className="m-0 h-full max-h-none w-[310px] max-w-[85vw] border-r border-ink-border-strong bg-ink-panel-2 p-0 text-ink-text shadow-e3 backdrop:bg-midnight/70"
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between py-4 pl-5 pr-2">
            <div className="flex flex-col gap-2">
              <GridLogo className="h-10 w-auto self-start" />
              <span className="overline tracking-[0.16em]">Business Site Analysis</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="btn min-w-tap px-0 text-ink-muted" aria-label="Close menu">✕</button>
          </div>
          <SidebarNav onNavigate={() => setOpen(false)} />
          <div className="mt-auto space-y-1 border-t border-ink-border px-5 pb-6 pt-4">
            <p className="text-label font-normal text-ink-text">{email}</p>
            <p className="overline">{role}</p>
            <Link href="/settings" onClick={() => setOpen(false)} className="nav-item -mx-3">Settings</Link>
            <LogoutButton className="nav-item -mx-3 w-full" />
          </div>
        </div>
      </dialog>
    </>
  );
}
