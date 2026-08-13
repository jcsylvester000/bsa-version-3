'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }
  return (
    <button onClick={logout} className="rounded-lg border border-ink-border px-3 py-1 text-xs text-ink-muted hover:bg-ink-hover hover:text-ink-text">
      Sign out
    </button>
  );
}
