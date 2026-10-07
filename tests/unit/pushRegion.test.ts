/**
 * Local-first region push (prisma/pushRegion.ts): the upsert never copies the per-database poi.id,
 * conflicts on the natural key, and logs hosts without credentials. (The generated SQL was also run
 * against a real Postgres in the sandbox: re-runs are idempotent and existing target rows keep their ids.)
 */
import { describe, it, expect } from 'vitest';
import { buildUpsertSql, hostOf } from '../../prisma/pushRegion';

describe('buildUpsertSql', () => {
  it('upserts on the natural key and updates every other column', () => {
    const sql = buildUpsertSql('poi', 'osm_id', ['name', 'region', 'osm_id', 'geom']);
    expect(sql).toContain('INSERT INTO "poi" ("name", "region", "osm_id", "geom")');
    expect(sql).toContain('jsonb_populate_recordset(NULL::"poi", $1::jsonb)');
    expect(sql).toContain('ON CONFLICT ("osm_id") DO UPDATE SET "name" = EXCLUDED."name", "region" = EXCLUDED."region", "geom" = EXCLUDED."geom"');
    expect(sql).not.toMatch(/"id"/);
  });
  it('supports a composite key and a partial-index conflict target', () => {
    const typed = buildUpsertSql('poi', ['osm_type', 'osm_id'], ['name', 'osm_type', 'osm_id']);
    expect(typed).toContain('ON CONFLICT ("osm_type", "osm_id") DO UPDATE SET "name" = EXCLUDED."name"');
    expect(typed).not.toContain('"osm_type" = EXCLUDED');
    const legacy = buildUpsertSql('poi', 'osm_id', ['name', 'osm_id'], 'osm_type IS NULL');
    expect(legacy).toContain('ON CONFLICT ("osm_id") WHERE osm_type IS NULL DO UPDATE');
  });
  it('quotes identifiers safely', () => {
    expect(buildUpsertSql('t', 'k', ['k', 'we"ird'])).toContain('"we""ird"');
  });
});

describe('hostOf', () => {
  it('never prints credentials', () => {
    const h = hostOf('postgresql://neondb_owner:SECRET@ep-cool-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require');
    expect(h).toBe('ep-cool-123.ap-southeast-1.aws.neon.tech/neondb');
    expect(h).not.toContain('SECRET');
    expect(hostOf('postgresql://bsa:bsa_local_dev@localhost:5433/bsa_dev')).toBe('localhost:5433/bsa_dev');
  });
});
