'use client';

import { useState } from 'react';

/**
 * Change-password form. Posts to /api/auth/password, which verifies the current password
 * server-side before rotating the hash. Client-side we only pre-check the confirm match
 * and minimum length so the user gets instant feedback; the server is the real gate.
 */
export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (next !== confirm) {
      setError('New password and confirmation do not match.');
      return;
    }
    if (next.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    const res = await fetch('/api/auth/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    })
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: { message: 'Network error. Please try again.' } }));
    setLoading(false);
    if (!res.ok) {
      setError(res.error?.message ?? 'Could not change the password.');
      return;
    }
    setDone(true);
    setCurrent('');
    setNext('');
    setConfirm('');
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <label className="block">
        <span className="text-sm font-medium text-ink-muted">Current password</span>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="field mt-1" required autoComplete="current-password" />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink-muted">New password</span>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="at least 6 characters" className="field mt-1" required minLength={6} autoComplete="new-password" />
      </label>
      <label className="block">
        <span className="text-sm font-medium text-ink-muted">Confirm new password</span>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field mt-1" required minLength={6} autoComplete="new-password" />
      </label>
      {error && <p className="text-sm text-nogo">{error}</p>}
      {done && <p className="text-sm text-go">Password updated.</p>}
      <button type="submit" disabled={loading} className="btn-accent justify-center">
        {loading ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
