#!/usr/bin/env node
/**
 * Export every row of the BSA database (Neon) into a portable snapshot that the
 * BSA database image restores on first start.
 *
 *   node scripts/exportNeonSnapshot.mjs [outDir]    (reads DATABASE_URL from .env)
 *   NEON_URL=postgresql://... node scripts/exportNeonSnapshot.mjs [outDir]
 *
 * outDir defaults to db-snapshot/ (git-ignored — the snapshot contains user accounts):
 *   bsa-data.sql.gz   INSERT statements for every table (parents before children) + sequence values
 *   manifest.json     row counts and columns (for the record)
 *   counts.tsv        table<TAB>rows — the image checks the restore against it
 *
 * Read-only against Neon: it runs SELECTs only. Uses the Neon HTTPS driver, so it
 * works from any machine that can reach neon.tech over HTTPS (no pg_dump needed).
 * Schema is NOT exported here; the image builds it from prisma/migrations, which is
 * exactly what Neon was built from (`prisma migrate deploy` on every Netlify build).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { neon, neonConfig } = require('@neondatabase/serverless');

function envUrl() {
  if (process.env.NEON_URL) return process.env.NEON_URL;
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const f = path.resolve('.env');
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*"?([^"\s]+)"?/);
      if (m) return m[1];
    }
  }
  throw new Error('No DATABASE_URL found (set NEON_URL or run from "4 - Final Application" with .env present).');
}

// Local testing only: point the driver at a Neon /sql emulator.
if (process.env.BSA_NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.BSA_NEON_FETCH_ENDPOINT;

const sql = neon(envUrl());
const q = (text, params = []) => sql.query ? sql.query(text, params) : sql(text, params);

const OUT = path.resolve(process.argv[2] || process.env.SNAPSHOT_DIR || 'db-snapshot');
const SKIP = new Set(['spatial_ref_sys']); // owned by PostGIS
const MAX_BATCH_BYTES = 8 * 1024 * 1024;     // keep each HTTPS response well under Neon's limit
const ident = (s) => '"' + s.replace(/"/g, '""') + '"';
const lit = (s) => "'" + s.replace(/'/g, "''") + "'";

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const [{ version }] = await q('select version()');
  const exts = await q('select extname, extversion from pg_extension order by 1');
  const names = (await q(
    `select tablename from pg_tables where schemaname = 'public' order by tablename`,
  )).map((r) => r.tablename).filter((t) => !SKIP.has(t));
  // Parents before children, so the restore also works where FK checks can't be switched off
  // (e.g. a managed Postgres without superuser).
  const fks = await q(
    `select c.relname as child, p.relname as parent from pg_constraint k
       join pg_class c on c.oid = k.conrelid join pg_class p on p.oid = k.confrelid
       join pg_namespace n on n.oid = c.relnamespace
      where k.contype = 'f' and n.nspname = 'public' and c.relname <> p.relname`);
  const tables = [], seen = new Set();
  const visit = (t, stack = new Set()) => {
    if (seen.has(t) || stack.has(t)) return;
    stack.add(t);
    for (const f of fks) if (f.child === t && names.includes(f.parent)) visit(f.parent, stack);
    seen.add(t); tables.push(t);
  };
  names.forEach((t) => visit(t));

  const gz = zlib.createGzip({ level: 9 });
  const file = fs.createWriteStream(path.join(OUT, 'bsa-data.sql.gz'));
  gz.pipe(file);
  const write = (s) => new Promise((res) => (gz.write(s) ? res() : gz.once('drain', res)));

  await write(`-- BSA database snapshot exported ${new Date().toISOString()}\n`);
  await write(`-- Source: ${version}\n`);
  await write(`SET client_encoding = 'UTF8';\nSET standard_conforming_strings = on;\n`);
  // Skip FK/trigger checks during the load when allowed (superuser, e.g. the Docker image);
  // elsewhere the parent-first order below keeps the load valid.
  await write(`DO $$ BEGIN SET session_replication_role = replica; EXCEPTION WHEN insufficient_privilege THEN RAISE NOTICE 'loading with FK checks on'; END $$;\n`);
  await write(`TRUNCATE public."_prisma_migrations";\n`);

  const manifest = { exportedAt: new Date().toISOString(), source: version, extensions: exts, tables: {} };
  for (const t of tables) {
    const cols = await q(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type, a.attgenerated <> '' as generated
         from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = $1 and a.attnum > 0 and not a.attisdropped
        order by a.attnum`, [t]);
    const [{ n, bytes }] = await q(
      `select count(*)::int as n, coalesce(sum(pg_column_size(x.*)), 0)::bigint as bytes from public.${ident(t)} x`);
    const avg = n ? Number(bytes) / n : 0;
    const batch = Math.max(1, Math.min(2000, Math.floor(MAX_BATCH_BYTES / Math.max(avg * 2, 1))));
    const ins = cols.filter((c) => !c.generated);
    const colList = ins.map((c) => ident(c.name)).join(', ');
    const selList = ins.map((c) => `(v.r::public.${ident(t)}).${ident(c.name)}`).join(', ');
    manifest.tables[t] = { rows: n, columns: cols.map((c) => `${c.name}:${c.type}`) };
    process.stdout.write(`${t.padEnd(36)} ${String(n).padStart(8)} rows `);
    if (!n) { console.log(''); continue; }
    await write(`\n-- ${t}: ${n} rows\n`);
    let done = 0;
    // ctid order is stable for paging because the export only reads.
    while (done < n) {
      const rows = await q(`select x::text as r from public.${ident(t)} x order by x.ctid offset ${done} limit ${batch}`);
      if (!rows.length) break;
      await write(`INSERT INTO public.${ident(t)} (${colList}) SELECT ${selList} FROM (VALUES\n`
        + rows.map((r) => `(${lit(r.r)})`).join(',\n') + `\n) v(r);\n`);
      done += rows.length;
      process.stdout.write('.');
    }
    if (done !== n) throw new Error(`${t}: exported ${done} of ${n} rows`);
    console.log(' ok');
  }

  const seqs = await q(`select sequencename, last_value from pg_sequences where schemaname = 'public'`);
  await write(`\n-- sequences\n`);
  for (const s of seqs) {
    if (s.last_value != null) {
      await write(`DO $$ BEGIN PERFORM setval(${lit('public.' + ident(s.sequencename))}, ${s.last_value}, true); END $$;\n`);
    }
  }
  manifest.sequences = seqs;
  await write(`DO $$ BEGIN SET session_replication_role = origin; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;\n`);
  gz.end();
  await new Promise((res) => file.on('close', res));

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(OUT, 'counts.tsv'),
    Object.entries(manifest.tables).map(([t, v]) => `${t}	${v.rows}
`).join(''));
  const total = Object.values(manifest.tables).reduce((a, b) => a + b.rows, 0);
  const mb = (fs.statSync(path.join(OUT, 'bsa-data.sql.gz')).size / 1048576).toFixed(1);
  console.log(`\nDone: ${tables.length} tables, ${total} rows → ${OUT}${path.sep}bsa-data.sql.gz (${mb} MB)`);
}

main().catch((e) => { console.error('\nExport failed:', e.message); process.exit(1); });
