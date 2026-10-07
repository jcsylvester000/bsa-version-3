/**
 * "Show on the map first, then save": the preview writes nothing and hands each OSM place a receipt;
 * on save the server re-derives trust — only an untouched OSM place is Verified. Everything else
 * (renamed, moved, from a file, hand-placed) is Assumed and can never overwrite a stored place.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/audit/audit', () => ({ audit: vi.fn() }));
vi.mock('@/lib/auth/session', () => ({ getSession: vi.fn() }));

import { signCandidate, verifyCandidate } from '@/lib/capture/signing';
import { resolveSaveItems, type SaveItem } from '@/lib/services/capture';
import { reasonOf } from '@/lib/api/adminCapture';

const base = { osmRef: 'node/42', name: 'Jollibee Nuvali', kind: 'amenity=fast_food', lat: 14.2846, lon: 121.0966 };
const receipt = signCandidate(base);
const item = (o: Partial<SaveItem> = {}): SaveItem => ({ ...base, receipt, category: 'competitor', origin: 'osm', ...o });

describe('preview receipts', () => {
  it('verify only the exact fields that were fetched', () => {
    expect(verifyCandidate(base, receipt)).toBe(true);
    expect(verifyCandidate({ ...base, name: 'Jollibee Nuvali 2' }, receipt)).toBe(false);
    expect(verifyCandidate({ ...base, lat: 14.29 }, receipt)).toBe(false);
    expect(verifyCandidate({ ...base, osmRef: 'way/42' }, receipt)).toBe(false);
    expect(verifyCandidate(base, null)).toBe(false);
    expect(verifyCandidate(base, 'x'.repeat(32))).toBe(false);
  });
});

describe('server-side trust on save', () => {
  it('untouched OSM place → Verified; category edits keep it Verified', () => {
    const [r] = resolveSaveItems([item({ category: 'anchor' })]);
    expect(r.verified).toBe(true);
    expect(r.category).toBe('anchor');
    expect(r.osmType).toBe('node'); expect(r.osmId).toBe(42);
  });
  it('renamed, moved, file-origin or forged places → Assumed', () => {
    expect(resolveSaveItems([item({ name: 'Jollibee Sta Rosa' })])[0].verified).toBe(false);
    expect(resolveSaveItems([item({ lat: 14.3 })])[0].verified).toBe(false);
    expect(resolveSaveItems([item({ origin: 'file' })])[0].verified).toBe(false);
    expect(resolveSaveItems([item({ receipt: 'y'.repeat(32) })])[0].verified).toBe(false);
  });
  it('hand-placed pins are manual and Assumed; blanks and repeats are dropped', () => {
    const out = resolveSaveItems([
      { name: 'Vacant lot near SM', category: 'other', lat: 14.28, lon: 121.09, origin: 'manual' },
      { name: '   ', category: 'other', lat: 14.28, lon: 121.09, origin: 'manual' },
      item(), item(),
    ]);
    expect(out).toHaveLength(2);
    const pin = out.find((o) => o.source === 'manual')!;
    expect(pin.verified).toBe(false);
    expect(pin.osmId).toBeNull();
  });
});

describe('failure reasons shown to the admin', () => {
  it('names a missing migration instead of a bare 500', () => {
    expect(reasonOf(new Error('relation "poi_capture_batch" does not exist'))).toBe('db_migration_pending');
    expect(reasonOf(new Error('column "osm_type" does not exist'))).toBe('db_migration_pending');
    expect(reasonOf(new Error('function similarity(text, text) does not exist'))).toBe('db_pg_trgm_missing');
    expect(reasonOf(new Error('boom'))).toBe('unexpected');
  });
});
