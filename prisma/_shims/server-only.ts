// Empty stand-in for the `server-only` marker package, used ONLY when running the
// CLI scripts (seed/ingest) through tsx — where there is no Next.js server bundle.
// The real `server-only` package throws on import by design; the app build still
// uses the real one. This shim is wired in via tsconfig.scripts.json paths.
export {};
