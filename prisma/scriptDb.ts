/**
 * Script-only Prisma client on the DIRECT (pooled) connection — NOT the Neon HTTP adapter (F-22).
 *
 * The app's `lib/db/prisma` uses the Neon HTTP adapter so it works from serverless functions, but
 * HTTP mode has no transactions and pays a round-trip per statement — fine for the app, far too slow
 * for a province-scale reference-data load. Bulk loaders run only from Node scripts (never serverless),
 * so here we use a normal TCP PrismaClient against DIRECT_URL (Neon's pooled endpoint), which supports
 * multi-row INSERTs and keeps a warm connection. Import this in ingest scripts and pass it to the
 * loaders' `db` option; the loaders default to the app client when it isn't supplied.
 */
import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function scriptDb(): PrismaClient {
  if (client) return client;
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('scriptDb: set DIRECT_URL (preferred) or DATABASE_URL before running a bulk loader.');
  client = new PrismaClient({ datasources: { db: { url } }, log: ['warn', 'error'] });
  return client;
}

export async function disconnectScriptDb(): Promise<void> {
  if (client) { await client.$disconnect(); client = null; }
}
