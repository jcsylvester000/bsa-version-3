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
    if (next.length < 10) {
      setError('New password must be at least 10 characters.');
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
        <span className="field-label">Current password</span>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className="field mt-1.5" required autoComplete="current-password" />
      </label>
      <label className="block">
        <span className="field-label">New password</span>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="at least 10 characters" className="field mt-1.5" required minLength={10} autoComplete="new-password" aria-describedby="new-pw-help" />
        <span id="new-pw-help" className="field-help mt-1.5 block">At least 10 characters.</span>
      </label>
      <label className="block">
        <span className="field-label">Confirm new password</span>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="field mt-1.5" required minLength={10} autoComplete="new-password" />
      </label>
      {error && (
        <div role="alert" className="error-state flex-row items-start gap-2 p-3 text-body">
          <span className="font-bold text-nogo" aria-hidden>✕</span> <span>{error}</span>
        </div>
      )}
      {done && <p role="status" className="text-body font-semibold text-go">✓ Password updated.</p>}
      <button type="submit" disabled={loading} className="btn-primary btn-lg">
        {loading ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}
