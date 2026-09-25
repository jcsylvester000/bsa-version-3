/**
 * F-22: reference-data loaders write in chunked multi-row statements, not one round trip per row.
 * We capture the SQL passed to $executeRaw (no DB needed) and assert the chunking and shape.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
// The loaders default to the app client; we never hit it here (we inject a mock db), but the module
// imports it, so stub it to avoid constructing a real client.
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { loadPoi, loadDemographics } from '@/lib/ingest/loaders';
import type { Sql } from '@prisma/client/runtime/library';

function mockDb() {
  const calls: Sql[] = [];
  const db = { $executeRaw: (sql: Sql) => { calls.push(sql); return Promise.resolve(1); } };
  return { db: db as never, calls };
}

beforeEach(() => vi.clearAllMocks());

describe('loadPoi batching', () => {
  it('writes osm_id rows in chunks of 500 with an ON CONFLICT upsert', async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      osm_id: i + 1, name: `Stop ${i}`, category: 'transport', lat: 14.55, lon: 121.02, region: 'ncr',
    }));
    const { db, calls } = mockDb();
    const rep = await loadPoi(rows as never, { db, source: 'osm', provenance: 'osm:transport' });
    expect(rep.loaded).toBe(1200);
    expect(calls.length).toBe(3); // ceil(1200/500)
    expect(calls[0].sql).toContain('INSERT INTO poi');
    expect(calls[0].sql).toContain('ON CONFLICT (osm_id) DO UPDATE');
    // 12 columns × 500 rows of parameters in the first chunk.
    expect(calls[0].values.length).toBe(12 * 500);
  });

  it('inserts id-less rows without an ON CONFLICT clause', async () => {
    const rows = [{ name: 'Manual POI', category: 'competitor', lat: 14.5, lon: 121.0, region: 'ncr' }];
    const { db, calls } = mockDb();
    await loadPoi(rows as never, { db });
    expect(calls.length).toBe(1);
    expect(calls[0].sql).not.toContain('ON CONFLICT');
  });
});

describe('loadDemographics batching', () => {
  it('chunks psgc upserts and folds geom into the statement', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({
      psgc_code: `PSGC${i}`, barangay: `B${i}`, city: 'Testville', population: 1000, lat: 14.5, lon: 121.0,
    }));
    const { db, calls } = mockDb();
    const rep = await loadDemographics(rows as never, { db });
    expect(rep.loaded).toBe(501);
    expect(calls.length).toBe(2); // 500 + 1
    expect(calls[0].sql).toContain('INSERT INTO demographic_cell');
    expect(calls[0].sql).toContain('ON CONFLICT (psgc_code) DO UPDATE');
    expect(calls[0].sql).toContain('geom = EXCLUDED.geom');
  });
});
