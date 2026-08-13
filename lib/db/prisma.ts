/**
 * Single Prisma client for the whole app — the one typed gateway to Postgres.
 * Prisma is server-only; it is never imported from a client component.
 *
 * Neon-ready: when DATABASE_URL points at neon.tech, we drive Prisma through the
 * Neon HTTP adapter (works from serverless/sandboxed runtimes). For local dev the
 * standard Postgres driver is used. Switching environments is a config change —
 * no code change — which is exactly the "local first, Neon later" requirement.
 *
 * Neon-HTTP constraint (carried from the architecture): nested writes are split
 * into sequential calls under the HTTP adapter, so data-access helpers avoid deep
 * nested creates.
 */
import { PrismaClient } from '@prisma/client';

const isNeon = (process.env.DATABASE_URL ?? '').includes('neon.tech');

function makeClient(): PrismaClient {
  if (isNeon) {
    // Lazy-require so local dev never needs the Neon packages resolved at runtime.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaNeonHTTP } = require('@prisma/adapter-neon');
    const adapter = new PrismaNeonHTTP(process.env.DATABASE_URL as string, {});
    return new PrismaClient({ adapter, log: ['warn', 'error'] });
  }
  return new PrismaClient({ log: ['warn', 'error'] });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
