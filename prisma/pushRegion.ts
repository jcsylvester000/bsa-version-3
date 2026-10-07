/**
 * Local-first reference data: copy one region's loaded rows from a SOURCE database (the local Docker
 * Postgres, where the slow OSM/boundary loads run without Neon idling out) into the TARGET database
 * (Neon — DIRECT_URL / DATABASE_URL from .env).
 *
 *   npm run db:push-region -- --region=cavite                 # copy, then report counts
 *   npm run db:push-region -- --region=cavite --dry-run       # counts only, writes nothing
 *   SOURCE_DATABASE_URL=postgresql://…  (default: the docker-compose DB on localhost:5433)
 *
 * What it copies (the tables the region loaders write):
 *   - admin_boundary  WHERE region = <region>        upsert on psgc_code (natural key)
 *   - poi             WHERE region = <region> AND osm_id IS NOT NULL
 *                                                    upsert on (osm_type, osm_id); legacy typeless rows on osm_id
 *     poi.id is a per-database autoincrement, so it is NEVER copied — the target assigns its own id and
 *     an existing row with the same key is updated in place (no duplicates, safe to re-run). Manual
 *     (admin-pinned) POIs have no osm key and are not pushed — pin them on the target directly.
 *
 * How: rows are read as JSON (`to_jsonb(t) - 'id'`, with the PostGIS geography re-serialised as its
 * canonical hex-EWKB text), and written with `jsonb_populate_recordset(NULL::<table>, $1)` so every column — geometry,
 * timestamps, arrays, enums — round-trips with its own Postgres type. Column lists come from the TARGET's
 * information_schema, so a column that exists only on one side is simply skipped. Batches of 500; the
 * target client is the retrying/keep-alive script client (prisma/scriptDb.ts).
 *
 * Both databases must be on the same migrations (`npx prisma migrate deploy` against each).
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { REGION_KEYS, type RegionKey } from '../lib/geo/regions';
import { scriptDb, disconnectScriptDb } from './scriptDb';

const DEFAULT_SOURCE = 'postgresql://bsa:bsa_local_dev@localhost:5433/bsa_dev?schema=public';
const BATCH = 500;

interface TableSpec {
  table: 'admin_boundary' | 'poi';
  /** Label for logs. */
  label: string;
  /** Natural-key columns: the ON CONFLICT target (never updated). */
  key: string[];
  /** Partial-index predicate for the ON CONFLICT target, when the unique index is partial. */
  conflictWhere?: string;
  /** SQL expression used for keyset pagination (unique per row within `where`). */
  pageKey: string;
  where: string;
  /** Columns never copied (local-only references, e.g. a capture batch that exists only here). */
  skipCols?: string[];
}
const POI_LOCAL_ONLY = ['capture_batch_id', 'verified_by'];
const TABLES: TableSpec[] = [
  // Boundaries first, so the POIs' psgc/barangay tags point at rows that exist on the target.
  { table: 'admin_boundary', label: 'admin_boundary', key: ['psgc_code'], pageKey: 'psgc_code::text', where: 'region = $1' },
  // Typed OSM rows: natural key (osm_type, osm_id) — node N and way N are different places.
  { table: 'poi', label: 'poi (osm)', key: ['osm_type', 'osm_id'], pageKey: "osm_type || '/' || osm_id::text",
    where: 'region = $1 AND osm_id IS NOT NULL AND osm_type IS NOT NULL', skipCols: POI_LOCAL_ONLY },
  // Legacy rows loaded before osm_type existed keep the old osm_id-only key (partial unique index).
  { table: 'poi', label: 'poi (legacy osm)', key: ['osm_id'], conflictWhere: 'osm_type IS NULL', pageKey: 'osm_id::text',
    where: 'region = $1 AND osm_id IS NOT NULL AND osm_type IS NULL', skipCols: POI_LOCAL_ONLY },
];

/** Host part of a Postgres URL, for logs (never prints credentials). */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

/** Build the upsert for one table. Pure — unit-tested. `cols` excludes the local-only `id`.
 *  `key` is the natural key (one column or several); `conflictWhere` targets a partial unique index. */
export function buildUpsertSql(table: string, key: string | string[], cols: string[], conflictWhere?: string): string {
  const q = (c: string) => `"${c.replace(/"/g, '""')}"`;
  const keys = Array.isArray(key) ? key : [key];
  const list = cols.map(q).join(', ');
  const updates = cols.filter((c) => !keys.includes(c)).map((c) => `${q(c)} = EXCLUDED.${q(c)}`).join(', ');
  return (
    `INSERT INTO ${q(table)} (${list}) ` +
    `SELECT ${list} FROM jsonb_populate_recordset(NULL::${q(table)}, $1::jsonb) ` +
    `ON CONFLICT (${keys.map(q).join(', ')})${conflictWhere ? ` WHERE ${conflictWhere}` : ''} DO ${updates ? `UPDATE SET ${updates}` : 'NOTHING'}`
  );
}

function parseArgs(argv: string[]) {
  const r = argv.find((a) => a.startsWith('--region='))?.slice('--region='.length);
  if (!r || !(REGION_KEYS as readonly string[]).includes(r)) {
    console.error(`Usage: npm run db:push-region -- --region=<${REGION_KEYS.join('|')}> [--dry-run]`);
    process.exit(1);
  }
  return { region: r as RegionKey, dryRun: argv.includes('--dry-run') };
}

async function targetColumns(target: PrismaClient, table: string): Promise<string[]> {
  const rows = await target.$queryRawUnsafe<Array<{ column_name: string }>>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position`,
    table,
  );
  return rows.map((r) => r.column_name).filter((c) => c !== 'id' || table !== 'poi');
}

async function main() {
  const { region, dryRun } = parseArgs(process.argv.slice(2));
  const sourceUrl = process.env.SOURCE_DATABASE_URL || DEFAULT_SOURCE;
  const targetUrl = process.env.DIRECT_URL || process.env.DATABASE_URL || '';
  if (!targetUrl) throw new Error('Set DIRECT_URL (or DATABASE_URL) in .env to the Neon database before pushing.');
  if (hostOf(sourceUrl) === hostOf(targetUrl)) {
    throw new Error(`Source and target are the same database (${hostOf(targetUrl)}). In this PowerShell window, remove the local override first: Remove-Item Env:DATABASE_URL; Remove-Item Env:DIRECT_URL`);
  }

  console.log(`Push region "${region}"${dryRun ? ' (dry run — nothing will be written)' : ''}`);
  console.log(`  from: ${hostOf(sourceUrl)}`);
  console.log(`  to:   ${hostOf(targetUrl)}\n`);

  const source = new PrismaClient({ datasources: { db: { url: sourceUrl } }, log: ['error'] });
  const target = scriptDb();

  try {
    for (const spec of TABLES) {
      const [{ n }] = await source.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "${spec.table}" WHERE ${spec.where}`, region,
      );
      const total = Number(n);
      if (total === 0) { console.log(`  ${spec.label}: 0 rows for ${region} in the source — nothing to copy.`); continue; }
      if (dryRun) { console.log(`  ${spec.label}: ${total} rows would be copied.`); continue; }

      const cols = (await targetColumns(target, spec.table)).filter((c) => !(spec.skipCols ?? []).includes(c));
      const sql = buildUpsertSql(spec.table, spec.key, cols, spec.conflictWhere);
      let done = 0;
      // Keyset pagination on the natural key keeps each read cheap and the order stable.
      let after: string | null = null;
      for (;;) {
        const page: Array<{ k: string; row: unknown }> = await source.$queryRawUnsafe(
          // geom is re-serialised as its canonical text (hex EWKB): PostGIS may otherwise emit GeoJSON
          // through a json cast, which jsonb_populate_recordset could not turn back into a geography.
          `SELECT (${spec.pageKey}) AS k,
                  (to_jsonb(t) - 'id') || jsonb_build_object('geom', t.geom::text) AS row
           FROM "${spec.table}" t
           WHERE ${spec.where} ${after === null ? '' : `AND (${spec.pageKey}) > $2`}
           ORDER BY (${spec.pageKey}) LIMIT ${BATCH}`,
          ...(after === null ? [region] : [region, after]),
        );
        if (page.length === 0) break;
        await target.$executeRawUnsafe(sql, JSON.stringify(page.map((p) => p.row)));
        done += page.length;
        after = page[page.length - 1].k;
        process.stdout.write(`\r  ${spec.label}: ${done}/${total} copied`);
      }
      process.stdout.write('\n');
    }

    // Verify on the target.
    console.log('');
    for (const spec of TABLES) {
      const [{ n }] = await target.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "${spec.table}" WHERE ${spec.where}`, region,
      );
      console.log(`  target now has ${Number(n)} ${spec.label} rows for ${region}`);
    }
    console.log(`\nDone. Next (against Neon): npm run db:tag-boundaries   — tags any existing Neon sites/POIs in ${region}.`);
  } finally {
    await source.$disconnect();
    await disconnectScriptDb();
  }
}

// Run only as a script (the pure helpers above are imported by tests).
if (process.argv[1] && /pushRegion\.ts$/.test(process.argv[1])) {
  main().catch((e) => {
    console.error(`\nPush failed: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  });
}
