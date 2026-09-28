/**
 * Script-only Prisma client on the DIRECT (pooled) connection — NOT the Neon HTTP adapter (F-22).
 *
 * The app's `lib/db/prisma` uses the Neon HTTP adapter so it works from serverless functions, but
 * HTTP mode has no transactions and pays a round-trip per statement — fine for the app, far too slow
 * for a province-scale reference-data load. Bulk loaders run only from Node scripts (never serverless),
 * so here we use a normal TCP PrismaClient against DIRECT_URL (Neon's pooled endpoint), which supports
 * multi-row INSERTs and keeps a warm connection. Import this in ingest scripts and pass it to the
 * loaders' `db` option; the loaders default to the app client when it isn't supplied.
 *
 * Long-running loads vs Neon (2026-09-28 fix): the OSM sweep spends minutes waiting on Overpass between
 * writes. Neon suspends an idle compute (scale-to-zero) and its pooler drops idle sessions, killing the
 * TCP connection — Postgres `57P01 terminating connection due to administrator command`, then Prisma
 * P1017 on the next write, which aborted the ingest. Two guards:
 *   1. keep-alive — a `SELECT 1` every 60 s keeps the compute awake and the session warm;
 *   2. reconnect + retry — a write that fails with a connection-level error disconnects, waits
 *      (2 s → 5 s → 10 s, covering a Neon cold start) and retries. Safe because every loader write is an
 *      idempotent upsert keyed on a natural id (osm_id, psgc_code, …).
 */
import { PrismaClient } from '@prisma/client';

let base: PrismaClient | null = null;
let client: PrismaClient | null = null;
let keepAlive: ReturnType<typeof setInterval> | null = null;

const KEEPALIVE_MS = 60_000;
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

/** Connection-level failures worth a reconnect + retry (never data/constraint errors). */
export function isConnectionError(e: unknown): boolean {
  const err = e as { code?: string; message?: string } | null;
  const code = err?.code ?? '';
  const msg = String(err?.message ?? e ?? '');
  return (
    ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(code) ||
    /57P01|terminating connection|server has closed the connection|connection (?:reset|closed|terminated)|ECONNRESET|ETIMEDOUT|EPIPE|Can't reach database server/i.test(msg)
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function scriptDb(): PrismaClient {
  if (client) return client;
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('scriptDb: set DIRECT_URL (preferred) or DATABASE_URL before running a bulk loader.');
  const b = new PrismaClient({ datasources: { db: { url } }, log: ['warn', 'error'] });
  base = b;

  const extended = b.$extends({
    query: {
      async $allOperations({ operation, model, args, query }) {
        for (let attempt = 0; ; attempt++) {
          try {
            return await query(args);
          } catch (e) {
            if (!isConnectionError(e) || attempt >= RETRY_DELAYS_MS.length) throw e;
            const wait = RETRY_DELAYS_MS[attempt];
            console.warn(`   ↻ database connection dropped during ${model ?? ''}${model ? '.' : ''}${operation} — reconnecting in ${wait / 1000}s (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})`);
            await b.$disconnect().catch(() => {});
            await sleep(wait);
          }
        }
      },
    },
  });
  // The extension keeps every model/raw method with the same signatures; expose it as a PrismaClient.
  client = extended as unknown as PrismaClient;

  keepAlive = setInterval(() => {
    b.$queryRaw`SELECT 1`.catch(() => { /* the retry wrapper handles the next real write */ });
  }, KEEPALIVE_MS);
  keepAlive.unref(); // never keep the process alive just for the ping

  return client;
}

export async function disconnectScriptDb(): Promise<void> {
  if (keepAlive) { clearInterval(keepAlive); keepAlive = null; }
  if (base) { await base.$disconnect(); base = null; }
  client = null;
}
