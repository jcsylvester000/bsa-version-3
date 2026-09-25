/**
 * F-43: service-layer access control, with Prisma mocked (the pattern the dev team can extend into
 * full integration tests against a Neon test branch). Proves the runs service enforces canAccessRun.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
const findUnique = vi.fn();
const moduleFindMany = vi.fn();
const siteCount = vi.fn();
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    pipelineRun: { findUnique: (...a: unknown[]) => findUnique(...a) },
    moduleResult: { findMany: (...a: unknown[]) => moduleFindMany(...a) },
    candidateSite: { count: (...a: unknown[]) => siteCount(...a) },
  },
}));
vi.mock('@/lib/db/safeQuery', () => ({ safeQuery: async (fn: () => unknown) => ({ data: await fn() }) }));
vi.mock('@/lib/modules/dashboard', () => ({ buildDashboard: () => ({ ok: true }) }));

import { getRunDashboard } from '@/lib/services/runs';

const UUID = '11111111-1111-4111-8111-111111111111';
const staff = { id: 'a', email: 'a', role: 'admin' as const, franchisorId: null };
const broker = { id: 'b', email: 'b', role: 'broker' as const, franchisorId: 'fr-1' };

beforeEach(() => { findUnique.mockReset(); moduleFindMany.mockReset().mockResolvedValue([]); siteCount.mockReset().mockResolvedValue(0); });

describe('getRunDashboard access control', () => {
  it('returns null for a non-UUID runId (never hits the DB)', async () => {
    expect(await getRunDashboard(staff, 'mock-run-1')).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
  it('returns null when the run is missing', async () => {
    findUnique.mockResolvedValue(null);
    expect(await getRunDashboard(staff, UUID)).toBeNull();
  });
  it('denies a broker a run they do not own', async () => {
    findUnique.mockResolvedValue({ id: UUID, createdByUserId: 'someone-else', franchisorId: 'fr-2', status: 'ready', vertical: 'fnb_cafe', _count: { sites: 1 }, franchisor: { brandName: 'X' }, intake: null, confidence: null });
    expect(await getRunDashboard(broker, UUID)).toBeNull();
  });
  it('allows staff any run', async () => {
    findUnique.mockResolvedValue({ id: UUID, createdByUserId: 'someone-else', franchisorId: 'fr-2', status: 'ready', vertical: 'fnb_cafe', _count: { sites: 1 }, franchisor: { brandName: 'X' }, intake: null, confidence: null });
    const r = await getRunDashboard(staff, UUID);
    expect(r).not.toBeNull();
    expect(r!.run.id).toBe(UUID);
  });
  it('returns null for no session', async () => {
    expect(await getRunDashboard(null, UUID)).toBeNull();
  });
});
