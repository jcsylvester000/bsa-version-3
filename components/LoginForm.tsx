'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { GridLogo } from '@/components/GridLogo';
import { BROKER_DISCLAIMER_SHORT } from '@/lib/truth/guardrailCopy';

/** Makati skyline at night — Unsplash (free licence), hotlinked per Unsplash guidelines. CSP allows
 *  images.unsplash.com in middleware.ts. Sized for a ~1600px-wide panel. */
const LOGIN_PHOTO =
  'https://images.unsplash.com/photo-1521367887256-cd1eb3a83057?auto=format&fit=crop&w=1800&q=70';

/**
 * Sign-in / register form. F-27: the demo accounts are only prefilled and hinted when the server
 * says demo logins are actually enabled (`demo` prop from isMockAuth()); on a real deployment the
 * fields start empty and no credentials are printed on the page.
 */
export function LoginForm({ demo }: { demo: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // Login
  const [email, setEmail] = useState(demo ? 'owner@macaoimperial.test' : '');
  const [password, setPassword] = useState(demo ? 'bsa-demo-1234' : '');
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
      {/* Left panel (desktop) — Makati at night, blended into the brand navy. The photo sits under two
          gradients: a left-to-right navy wash so the copy stays readable, and a bottom fade into the
          panel so the disclaimer sits on solid colour. Decorative only (alt=""). */}
      <section className="relative hidden overflow-hidden border-r border-ink-border bg-ink-panel-2 lg:flex">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={LOGIN_PHOTO}
          alt=""
          aria-hidden
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-60 mix-blend-luminosity"
        />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink-panel-2 via-ink-panel-2/80 to-ink-panel-2/20" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink-panel-2 via-transparent to-ink-panel-2/60" />
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_20%,rgba(190,133,98,0.18),transparent_55%)]" />

        <div className="relative z-10 flex w-full flex-col justify-between p-14 xl:p-20">
          <GridLogo className="h-16 w-auto self-start" />
          <div className="flex max-w-2xl flex-col gap-6">
            <p className="overline">Business Site Analysis</p>
            <h1 className="font-heading text-[44px] leading-[1.1] xl:text-[56px]">Check a site before you commit.</h1>
            <p className="rationale max-w-xl text-body-lg">
              Territory, rent position, demand timing and white-space for up to five sites — rolled into one clear call you can take to your client.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <p className="notice-ra max-w-xl">{BROKER_DISCLAIMER_SHORT}</p>
            <p className="text-xs text-ink-muted/80">
              Photo: Eula Xandrea Dimapilis / <a href="https://unsplash.com/photos/aerial-photography-of-city-buildings-at-night-1Y0-8A4mkEc" target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-ink-text">Unsplash</a>
            </p>
          </div>
        </div>
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
              {demo && <p className="field-help">Demo: owner@macaoimperial.test · analyst@grid.test — password bsa-demo-1234</p>}
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
