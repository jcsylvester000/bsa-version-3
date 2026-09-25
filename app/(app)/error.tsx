'use client';

import { useEffect } from 'react';
import Link from 'next/link';

/**
 * Signed-in error boundary (design v2 · H4). Any uncaught render/data error inside the app shell
 * lands here instead of a blank page. The message is deliberately generic — the real error stays in
 * the server log (never echo internals to the browser); `digest` lets support match the log line.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Client-side trace only; the server already logged the full error.
    console.error('[bsa] page error', error.digest ?? '');
  }, [error]);

  return (
    <div role="alert" className="error-state max-w-xl">
      <p className="text-label font-semibold text-nogo"><span aria-hidden>✕ </span>Something went wrong</p>
      <h1 className="font-body text-title text-ink-text">We couldn’t load this page</h1>
      <p className="text-body text-ink-muted">Your connection may have dropped. Your runs and inputs are safe.</p>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <button type="button" onClick={reset} className="btn-primary">↻ Try again</button>
        <Link href="/runs" className="link inline-flex min-h-tap items-center">Back to Site Dashboard</Link>
      </div>
      {error.digest && <p className="text-label font-normal text-ink-muted">Reference: {error.digest}</p>}
    </div>
  );
}
