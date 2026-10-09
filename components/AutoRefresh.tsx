'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Re-fetches the server-rendered page on an interval (only while mounted, only when the tab is visible). */
export function AutoRefresh({ everyMs = 60_000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, Math.max(15_000, everyMs));
    return () => clearInterval(t);
  }, [router, everyMs]);
  return null;
}
