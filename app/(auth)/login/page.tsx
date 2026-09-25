'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GridLogo } from '@/components/GridLogo';
import { BROKER_DISCLAIMER_SHORT } from '@/lib/truth/guardrailCopy';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login
  const [email, setEmail] = useState('owner@macaoimperial.test');
  const [password, setPassword] = useState('bsa-demo-1234');
  // Register
  const [username, setUsername] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');

  const [error, setError] = useState<string | null>(null);
  // Confirm-field mismatch is shown on the field itself (field-error + aria-invalid), not only in the alert.
  const mismatch = mode === 'register' && regConfirm.length > 0 && regPassword !== regConfirm;
  const [loading, setLoading] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then((r) => r.json());
    setLoading(false);
    if (!res.ok) { setError(res.error?.message ?? 'Login failed.'); return; }
    router.push('/runs'); router.refresh();
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (regPassword !== regConfirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    const res = await fetch('/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: regPassword }),
    }).then((r) => r.json());
    setLoading(false);
    if (!res.ok) { setError(res.error?.message ?? 'Registration failed.'); return; }
    // Registered + signed in → land on the app; the first-run tour will start.
    router.push('/runs'); router.refresh();
  }

  const tabCls = (active: boolean) =>
    `focus-ring min-h-tap rounded-[9px] text-body ${active ? 'border border-ink-border-strong bg-ink-panel font-semibold text-ink-text' : 'text-ink-muted hover:text-ink-text'}`;

  return (
    <main className="grid min-h-screen bg-ink-bg lg:grid-cols-[minmax(0,1fr)_520px]">
      {/* Left panel (desktop) — mockup C1 */}
      <section className="hidden flex-col justify-between border-r border-ink-border bg-ink-panel-2 p-14 lg:flex">
        <GridLogo className="h-16 w-auto self-start" />
        <div className="flex max-w-xl flex-col gap-5">
          <p className="overline">Business Site Analysis</p>
          <h1 className="font-heading text-[40px] leading-[1.15]">Check a site before you commit.</h1>
          <p className="rationale text-body-lg">
            Territory, rent position, demand timing and white-space for up to five sites — rolled into one clear call you can take to your client.
          </p>
        </div>
        <p className="notice-ra max-w-xl">{BROKER_DISCLAIMER_SHORT}</p>
      </section>

      {/* Form column */}
      <section className="flex flex-col justify-center px-4 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex flex-col gap-2 lg:hidden">
            <GridLogo className="h-12 w-auto self-start" />
            <p className="overline">Business Site Analysis</p>
          </div>
          <h2 className="text-h2">{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p className="mb-6 mt-1 text-body text-ink-muted">{mode === 'login' ? 'Sign in to continue.' : 'You’ll get a short guided tour first.'}</p>

          {/* Tabs */}
          <div role="tablist" aria-label="Account" className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-ink-border bg-ink-panel-2 p-1">
            <button type="button" role="tab" aria-selected={mode === 'login'} onClick={() => { setMode('login'); setError(null); }} className={tabCls(mode === 'login')}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === 'register'} onClick={() => { setMode('register'); setError(null); }} className={tabCls(mode === 'register')}>Create account</button>
          </div>

          {error && (
            <div role="alert" className="error-state mb-5 flex-row items-start gap-2 p-3 text-body">
              <span className="font-bold text-nogo" aria-hidden>✕</span> <span>{error}</span>
            </div>
          )}

          {mode === 'login' ? (
            <form onSubmit={onLogin} className="space-y-5">
              <label className="block">
                <span className="field-label">Username or email</span>
                <input value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1.5" autoComplete="username" required />
              </label>
              <label className="block">
                <span className="field-label">Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1.5" autoComplete="current-password" required />
              </label>
              <button type="submit" disabled={loading} className="btn-primary btn-lg w-full">{loading ? 'Signing in…' : 'Sign in'}</button>
              <p className="field-help">Forgot your password? Ask your Grid administrator to reset it.</p>
              <p className="field-help">Demo: owner@macaoimperial.test · analyst@grid.test — password bsa-demo-1234</p>
            </form>
          ) : (
            <form onSubmit={onRegister} className="space-y-5">
              <label className="block">
                <span className="field-label">Username</span>
                <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="pick a username" className="field mt-1.5" autoComplete="username" required minLength={3} />
              </label>
              <label className="block">
                <span className="field-label">Password</span>
                <input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="at least 10 characters" className="field mt-1.5" autoComplete="new-password" required minLength={10} />
                {regPassword.length > 0 && (
                  <span className={`mt-1.5 block text-label font-normal ${regPassword.length >= 10 ? 'text-go' : 'text-ink-muted'}`}>
                    {regPassword.length >= 10 ? '✓' : '·'} At least 10 characters
                  </span>
                )}
              </label>
              <label className="block">
                <span className="field-label">Confirm password</span>
                <input
                  type="password"
                  value={regConfirm}
                  onChange={(e) => setRegConfirm(e.target.value)}
                  className={`field mt-1.5 ${mismatch ? 'field-error' : ''}`}
                  aria-invalid={mismatch || undefined}
                  aria-describedby={mismatch ? 'confirm-msg' : undefined}
                  autoComplete="new-password"
                  required
                  minLength={10}
                />
                {mismatch && <span id="confirm-msg" className="field-msg mt-1.5 block">✕ Doesn’t match the password above</span>}
              </label>
              <button type="submit" disabled={loading} className="btn-primary btn-lg w-full">{loading ? 'Creating…' : 'Create account & start'}</button>
            </form>
          )}

          <p className="notice-ra mt-8 lg:hidden">{BROKER_DISCLAIMER_SHORT}</p>
        </div>
      </section>
    </main>
  );
}
