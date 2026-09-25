'use client';

import { useRouter } from 'next/navigation';

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }
  return (
    <button
      type="button"
      onClick={logout}
      className={className ?? 'focus-ring inline-flex min-h-tap items-center rounded-control px-2 text-label font-normal text-ink-muted hover:text-ink-text'}
    >
      Log out
    </button>
  );
}
