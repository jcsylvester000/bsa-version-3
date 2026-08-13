'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { NewTag } from '@/components/ui/Chips';

/**
 * Left-rail navigation, grouped Workspace / Intelligence / Output like the mockup.
 * Feature links carry the current runId so the intelligence modules open in context.
 */
const GROUPS: Array<{ heading: string; items: Array<{ href: string; label: string; isNew?: boolean; keepRun?: boolean; tour?: string }> }> = [
  {
    heading: 'Workspace',
    items: [
      { href: '/screening', label: 'Franchise Screening', isNew: true },
      { href: '/runs', label: 'Site Dashboard', tour: 'nav-runs' },
      { href: '/intake', label: 'New Intake', tour: 'nav-intake' },
      { href: '/explore', label: 'Explore Places' },
    ],
  },
  {
    // The four per-module tools (Territory Guard, Lease Benchmark, Daypart, White-Space)
    // are intentionally NOT listed here — every New Intake already surfaces them on the
    // per-site results view (SiteIntelligenceTabs), so a standalone nav entry is redundant.
    // Their routes still exist and remain reachable in-context; only the left-rail links
    // are hidden to keep the menu focused on Workspace → All Modules → Output.
    heading: 'Intelligence',
    items: [
      { href: '/modules', label: 'All Modules', keepRun: true, tour: 'nav-modules' },
    ],
  },
  {
    heading: 'Output',
    items: [
      { href: '/reports', label: 'Site Report', keepRun: true, tour: 'nav-reports' },
      { href: '/scorecard', label: 'Scorecard', keepRun: true },
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
