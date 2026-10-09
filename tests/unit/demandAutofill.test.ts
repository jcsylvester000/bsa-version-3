/**
 * Demand tracking + automated back-fill: the pure rules, and the API boundary (admin-only views and
 * actions; the machine endpoint requires the CRON_SECRET bearer and fails closed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const session = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSession: () => session() }));
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth/rateLimit', () => ({ checkLimit: vi.fn(async () => ({ limited: false, retryAfterSeconds: 0 })), recordAttempt: vi.fn(async () => undefined) }));
vi.mock('@/lib/audit/audit', () => ({ audit: vi.fn(async () => undefined) }));
const runAutofill = vi.fn(async () => ({ refreshed: [], ms: 5 }));
const autofillOverview = vi.fn(async () => ({ enabled: true, dailyCap: 30, scheduled: true, usage: {}, jobs: [] }));
const setJobStatus = vi.fn(async () => true);
vi.mock('@/lib/services/autofill', () => ({
  runAutofill: (...a: unknown[]) => runAutofill(...(a as [])), autofillOverview: () => autofillOverview(), setJobStatus: (...a: unknown[]) => setJobStatus(...(a as [])),
}));
const demandOverview = vi.fn(async () => ({ days: 30, totals: {}, items: [] }));
const queueFillForDemand = vi.fn(async () => ({ jobId: 'j', alreadyCovered: false }));
vi.mock('@/lib/services/demand', async (orig) => {
  const real: Record<string, unknown> = await orig();
  return { ...real, demandOverview: (...a: unknown[]) => demandOverview(...(a as [])), queueFillForDemand: (...a: unknown[]) => queueFillForDemand(...(a as [])) };
});
vi.mock('@/lib/services/capture', () => ({ layerFreshness: vi.fn(), CaptureError: class extends Error {} }));

import { classifyCoverage, emptyContextLayers, fillAreaKey, fillLayersFor, fillAreaFor, RICH_PLACES, FILL_BASE_LAYERS } from '@/lib/services/demand';
import { cronAuthorized } from '@/lib/api/cron';
import { GET as demandGet } from '@/app/api/admin/capture/demand/route';
import { GET as fillGet, POST as fillPost } from '@/app/api/admin/capture/autofill/route';
import { POST as cron } from '@/app/api/internal/autofill/route';

const admin = { id: '11111111-1111-4111-8111-111111111111', email: 'a@grid', role: 'admin', franchisorId: null };
const broker = { ...admin, role: 'broker' };
const UUID = '22222222-2222-4222-8222-222222222222';
const get = (u: string) => new NextRequest(`http://localhost${u}`);
const post = (u: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  new NextRequest(`http://localhost${u}`, { method: 'POST', headers, body: JSON.stringify(body) });

beforeEach(() => { session.mockReset(); [runAutofill, autofillOverview, setJobStatus, demandOverview, queueFillForDemand].forEach((f) => f.mockClear()); });

describe('demand rules', () => {
  it('classifies what BSA had around a point', () => {
    expect(classifyCoverage(0, 0, 5)).toBe('gap');
    expect(classifyCoverage(3, 0, 5)).toBe('partial');
    expect(classifyCoverage(0, 2, 5)).toBe('partial');
    expect(classifyCoverage(0, 5, 5)).toBe('covered');
    expect(classifyCoverage(RICH_PLACES, 0, 5)).toBe('covered'); // bulk-ingested areas don't re-fetch
    // …unless a context layer has nothing at all nearby (NCR transport, data check 2026-10-09).
    expect(classifyCoverage(RICH_PLACES, 0, 5, 1)).toBe('partial');
    const cats = new Map([['competitor', 900], ['school', 4]]);
    expect(emptyContextLayers(['transport', 'health', 'education', 'anchors', 'v:fnb_qsr'] as never, cats)).toEqual(['transport', 'health']);
  });
  it('merges nearby requests into one ~1 km job and picks the layers', () => {
    expect(fillAreaKey(16.4126, 120.5978)).toBe(fillAreaKey(16.4131, 120.5981));
    expect(fillAreaKey(16.4126, 120.5978)).not.toBe(fillAreaKey(16.4226, 120.5978));
    expect(fillLayersFor('fnb_qsr')).toEqual(['v:fnb_qsr', ...FILL_BASE_LAYERS]);
    expect(fillLayersFor('other')).toEqual(FILL_BASE_LAYERS);
    expect(fillAreaFor(14.5547, 121.0244).radiusM).toBe(1000); // Makati CBD: dense-ring rule
    expect(fillAreaFor(16.4126, 120.5978).radiusM).toBe(1500);
  });
});

describe('cron secret', () => {
  const S = 'x'.repeat(40);
  it('fails closed', () => {
    expect(cronAuthorized(`Bearer ${S}`, S)).toBe(true);
    expect(cronAuthorized(`Bearer ${S}y`, S)).toBe(false);
    expect(cronAuthorized(null, S)).toBe(false);
    expect(cronAuthorized(`Bearer ${S}`, undefined)).toBe(false);
    expect(cronAuthorized('Bearer short', 'short')).toBe(false); // < 32 chars never accepted
  });
  describe('internal endpoint', () => {
    const old = process.env.CRON_SECRET;
    afterEach(() => { process.env.CRON_SECRET = old; });
    it('503 without a secret, 401 with a wrong one, runs with the right one', async () => {
      delete process.env.CRON_SECRET;
      expect((await cron(post('/api/internal/autofill', {}, {}))).status).toBe(503);
      process.env.CRON_SECRET = S;
      expect((await cron(post('/api/internal/autofill', {}, { authorization: 'Bearer nope' }))).status).toBe(401);
      expect(runAutofill).not.toHaveBeenCalled();
      expect((await cron(post('/api/internal/autofill', {}, { authorization: `Bearer ${S}` }))).status).toBe(200);
      expect(runAutofill).toHaveBeenCalledWith({ trigger: 'cron', budgetMs: 20_000 });
    });
  });
});

describe('admin demand + back-fill routes', () => {
  it('are admin only', async () => {
    session.mockResolvedValue(broker);
    expect((await demandGet(get('/api/admin/capture/demand'))).status).toBe(403);
    expect((await fillGet()).status).toBe(403);
    expect((await fillPost(post('/api/admin/capture/autofill', { action: 'run' }))).status).toBe(403);
    expect(runAutofill).not.toHaveBeenCalled(); expect(demandOverview).not.toHaveBeenCalled();
  });
  it('validate actions and are JSON only', async () => {
    session.mockResolvedValue(admin);
    expect((await fillPost(post('/api/admin/capture/autofill', { action: 'run' }, { 'content-type': 'text/plain' }))).status).toBe(415);
    expect((await fillPost(post('/api/admin/capture/autofill', { action: 'nuke' }))).status).toBe(422);
    expect((await fillPost(post('/api/admin/capture/autofill', { action: 'cancel', jobId: 'x' }))).status).toBe(422);
    expect((await fillPost(post('/api/admin/capture/autofill', { action: 'run' }))).status).toBe(200);
    expect((await fillPost(post('/api/admin/capture/autofill', { action: 'queue', demandId: UUID }))).status).toBe(200);
    expect((await fillPost(post('/api/admin/capture/autofill', { action: 'cancel', jobId: UUID }))).status).toBe(200);
    setJobStatus.mockResolvedValueOnce(false);
    expect((await fillPost(post('/api/admin/capture/autofill', { action: 'retry', jobId: UUID }))).status).toBe(409);
    expect((await demandGet(get('/api/admin/capture/demand?days=7'))).status).toBe(200);
    expect(demandOverview).toHaveBeenCalledWith({ days: 7 });
  });
});
