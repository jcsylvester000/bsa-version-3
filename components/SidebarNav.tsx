'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { NewTag } from '@/components/ui/Chips';

/**
 * Left-rail navigation. 44px targets, 16px labels, active item = hover surface + Muesli inset bar.
 * `onNavigate` lets the mobile drawer close itself after a tap.
 */
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

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const runId = params.get('runId');

  return (
    <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
      {GROUPS.map((g) => (
        <div key={g.heading}>
          <p className="overline px-3 pb-2">{g.heading}</p>
          <div className="space-y-1">
            {g.items.map((it) => {
              const href = it.keepRun && runId ? `${it.href}?runId=${runId}` : it.href;
              // /site belongs to the Site Dashboard section.
              const active = pathname === it.href || (it.href === '/runs' && pathname.startsWith('/site'));
              return (
                <Link
                  key={it.href}
                  href={href}
                  data-tour={it.tour}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`nav-item ${active ? 'nav-item-active' : ''}`}
                >
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
