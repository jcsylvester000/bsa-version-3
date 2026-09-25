'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { NewTag } from '@/components/ui/Chips';

/**
 * Left-rail navigation, grouped Workspace / Intelligence / Output like the mockup.
 * Feature links carry the current runId so the intelligence modules open in context.
 */
// Explore Places, All Modules and Scorecard were retired from the left rail (the per-site
// results view — SiteIntelligenceTabs — already surfaces the module intelligence and the
// exportable report). Their routes may still exist but are no longer linked in the menu.
const GROUPS: Array<{ heading: string; items: Array<{ href: string; label: string; isNew?: boolean; keepRun?: boolean; tour?: string }> }> = [
  {
    heading: 'Workspace',
    items: [
      { href: '/screening', label: 'Franchise Screening', isNew: true },
      { href: '/runs', label: 'Site Dashboard', tour: 'nav-runs' },
      { href: '/intake', label: 'New Intake', tour: 'nav-intake' },
    ],
  },
];

export function SidebarNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  const runId = params.get('runId');

  return (
    <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
      {GROUPS.map((g) => (
        <div key={g.heading}>
          <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted">{g.heading}</p>
          <div className="space-y-0.5">
            {g.items.map((it) => {
              const href = it.keepRun && runId ? `${it.href}?runId=${runId}` : it.href;
              const active = pathname === it.href;
              return (
                <Link key={it.href} href={href} data-tour={it.tour} className={`nav-item ${active ? 'nav-item-active' : ''}`}>
                  <span className="flex-1">{it.label}</span>
                  {it.isNew && <NewTag />}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
