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
    // @prisma/adapter-neon@5.22's PrismaNeonHTTP takes a Neon QUERY FUNCTION — the
    // result of neon(connectionString) — NOT the raw URL string. Passing the string
    // (the old code) left `this.client` undefined, so every query threw
    // "TypeError: this.client is not a function" at runtime on Netlify/Neon.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { neon, types } = require('@neondatabase/serverless');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaNeonHTTP } = require('@prisma/adapter-neon');

    // Normalize date/time columns to ISO-8601 so Prisma's own layer parses them.
    // @prisma/adapter-neon@5.22's HTTP path (PrismaNeonHTTP) — unlike its WebSocket
    // path — installs no type parser, so Neon's default parsing hands Prisma an
    // object ("… found {}"). Overriding the parser to pass raw text got us the real
    // value, but Postgres emits it as "2026-08-13 14:27:54.72+00" while Prisma's
    // adapter expects strict ISO ("2026-08-13T14:27:54.72Z") — otherwise:
    //   "Conversion failed: expected a datetime string in column 'created_at'".
    // So convert the space to 'T' and the "+00" zone suffix to 'Z'. This breaks
    // EVERY read of a row with a timestamptz/date default (login, screening, seeds…)
    // if not handled. OIDs: 1082 date · 1083 time · 1114 timestamp ·
    // 1184 timestamptz · 1266 timetz.
    const toIso = (v: string | null): string | null => {
      if (v == null) return v;
      // A bare DATE ("2026-08-13") has no time part — leave it untouched so the
      // zone-suffix rules below can't mangle the "-13".
      if (!v.includes(' ') && !v.includes('T')) return v;
      // "YYYY-MM-DD HH:MM:SS.sss+00" → "YYYY-MM-DDTHH:MM:SS.sssZ"
      let s = v.replace(' ', 'T');
      s = s.replace(/([+-])00(:00)?$/, 'Z');       // "+00" / "+00:00" → "Z"
      s = s.replace(/T.*[+-]\d{2}$/, (m) => `${m}:00`); // "+08" → "+08:00" (only in a time)
      return s;
    };
    for (const oid of [1082, 1083, 1114, 1184, 1266]) types.setTypeParser(oid, toIso);

    // JSON / JSONB columns (OIDs 114 / 3802) — the SAME class of bug as timestamps.
    // @prisma/adapter-neon@5.22's HTTP path (PrismaNeonHTTP.performIO) does NOT apply the
    // adapter's own `customParsers` (its WebSocket path does, via a custom getTypeParser),
    // so JSON columns come back through neon()'s GLOBAL parser. Neon's default parses JSON
    // text into a JS OBJECT, but Prisma's driver-adapter engine expects the RAW JSON STRING
    // and parses it itself — otherwise: P2023 "Failed to parse incoming json from a driver
    // adapter" on any create/read of a row with a JSON column (every intake: section_a…k).
    // This surfaces only on the serverless runtime, not local dev, because the two runtimes'
    // default parser state differs. Mirror the adapter's `toJson` (identity → raw string);
    // if neon ever hands us an already-parsed object, re-stringify so Prisma always gets text.
    const toRawJson = (v: unknown): string | null => {
      if (v == null) return v as null;
      return typeof v === 'string' ? v : JSON.stringify(v);
    };
    for (const oid of [114, 3802]) types.setTypeParser(oid, toRawJson);

    const sql = neon(process.env.DATABASE_URL as string);
    const adapter = new PrismaNeonHTTP(sql);
    return new PrismaClient({ adapter, log: ['warn', 'error'] });
  }
  return new PrismaClient({ log: ['warn', 'error'] });
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? makeClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
