'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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

  return (
    <main className="grid min-h-screen place-items-center bg-ink-bg px-4">
      <div className="w-full max-w-sm rounded-2xl border border-ink-border bg-ink-panel p-8 shadow-2xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-lg font-bold text-ink-bg">G</div>
          <div>
            <h1 className="text-xl font-bold text-ink-text">BSA</h1>
            <p className="text-xs text-ink-muted">Business Site Analysis · Grid Property Ventures</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg bg-ink-panel-2 p-1">
          <button onClick={() => { setMode('login'); setError(null); }} className={`rounded-md py-1.5 text-sm font-medium ${mode === 'login' ? 'bg-accent text-ink-bg' : 'text-ink-muted'}`}>Sign in</button>
          <button onClick={() => { setMode('register'); setError(null); }} className={`rounded-md py-1.5 text-sm font-medium ${mode === 'register' ? 'bg-accent text-ink-bg' : 'text-ink-muted'}`}>Create account</button>
        </div>

        {mode === 'login' ? (
          <form onSubmit={onLogin} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-ink-muted">Username or email</span>
              <input value={email} onChange={(e) => setEmail(e.target.value)} className="field mt-1" required />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-muted">Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="field mt-1" required />
            </label>
            {error && <p className="text-sm text-nogo">{error}</p>}
            <button type="submit" disabled={loading} className="btn-accent w-full justify-center">{loading ? 'Signing in…' : 'Sign in'}</button>
            <p className="text-xs text-ink-muted">Demo: owner@macaoimperial.test · analyst@grid.test — password bsa-demo-1234</p>
          </form>
        ) : (
          <form onSubmit={onRegister} className="space-y-4">
            <label className="block">
              <span className="text-sm font-medium text-ink-muted">Username</span>
              <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="pick a username" className="field mt-1" required minLength={3} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-muted">Password</span>
              <input type="password" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} placeholder="at least 6 characters" className="field mt-1" required minLength={6} />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-ink-muted">Confirm password</span>
              <input type="password" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} className="field mt-1" required minLength={6} />
            </label>
            {error && <p className="text-sm text-nogo">{error}</p>}
            <button type="submit" disabled={loading} className="btn-accent w-full justify-center">{loading ? 'Creating…' : 'Create account & start'}</button>
            <p className="text-xs text-ink-muted">You’ll get a guided tour of the app on your first visit.</p>
          </form>
        )}
      </div>
    </main>
  );
}
