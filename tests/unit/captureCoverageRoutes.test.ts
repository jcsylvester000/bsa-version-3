/**
 * Capture Coverage routes (log, retry queue, coverage cells) are ADMIN ONLY, the one mutation
 * (dismiss / re-open) is JSON-only and validated, and rejected requests never reach the service.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const session = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSession: () => session() }));
const svc = {
  captureLog: vi.fn(async () => ({ totals: {}, areas: [], gaps: [], regions: [], coverageKeys: [] })),
  listGaps: vi.fn(async () => []),
  getGap: vi.fn(async (id: string) => (id === '22222222-2222-4222-8222-222222222222' ? { id } : null)),
  setGapStatus: vi.fn(async () => ({ id: 'g', status: 'dismissed' })),
  coverageCells: vi.fn(async () => []),
  planCapture: vi.fn(async () => ({ layers: [], toFetch: [] })),
};
vi.mock('@/lib/services/capture', () => ({
  CaptureError: class CaptureError extends Error { constructor(public code: string, m: string, public status = 400) { super(m); } },
  captureLog: (...a: unknown[]) => svc.captureLog(...(a as [])),
  listGaps: (...a: unknown[]) => svc.listGaps(...(a as [])),
  getGap: (...a: unknown[]) => svc.getGap(...(a as [string])),
  setGapStatus: (...a: unknown[]) => svc.setGapStatus(...(a as [])),
  coverageCells: (...a: unknown[]) => svc.coverageCells(...(a as [])),
  planCapture: (...a: unknown[]) => svc.planCapture(...(a as [])),
}));
vi.mock('@/lib/places/osmService', () => ({ overpassStatus: vi.fn(async () => ({ reachable: true, slotsNow: 2, waitSeconds: 0, checkedAt: '' })) }));

import { GET as log } from '@/app/api/admin/capture/log/route';
import { GET as gaps } from '@/app/api/admin/capture/gaps/route';
import { GET as gapGet, POST as gapPost } from '@/app/api/admin/capture/gaps/[id]/route';
import { GET as cells } from '@/app/api/admin/capture/cells/route';
import { POST as plan } from '@/app/api/admin/capture/plan/route';
import { GET as osmStatus } from '@/app/api/admin/capture/osm-status/route';
import { SiteContextSchema } from '@/lib/api/adminCapture';

const admin = { id: '11111111-1111-4111-8111-111111111111', email: 'a@grid', role: 'admin', franchisorId: null };
const analyst = { ...admin, role: 'analyst' };
const GID = '22222222-2222-4222-8222-222222222222';
const get = (url: string) => new NextRequest(`http://localhost${url}`);
const post = (url: string, body: unknown, ct = 'application/json') => new NextRequest(`http://localhost${url}`, { method: 'POST', headers: { 'content-type': ct }, body: JSON.stringify(body) });

beforeEach(() => { session.mockReset(); Object.values(svc).forEach((f) => f.mockClear()); });

describe('capture coverage routes', () => {
  it('401 / 403 for non-admins — the service is never called', async () => {
    session.mockResolvedValue(null);
    expect((await log(get('/api/admin/capture/log'))).status).toBe(401);
    session.mockResolvedValue(analyst);
    expect((await log(get('/api/admin/capture/log'))).status).toBe(403);
    expect((await gaps(get('/api/admin/capture/gaps'))).status).toBe(403);
    expect((await gapGet(get(`/api/admin/capture/gaps/${GID}`), { params: { id: GID } })).status).toBe(403);
    expect((await gapPost(post(`/api/admin/capture/gaps/${GID}`, { action: 'dismiss' }), { params: { id: GID } })).status).toBe(403);
    expect((await cells(get('/api/admin/capture/cells?bbox=14.4,120.8,14.5,120.9&layer=fnb_qsr'))).status).toBe(403);
    for (const f of Object.values(svc)) expect(f).not.toHaveBeenCalled();
  });

  it('admin reads the log, the queue (status filter) and one entry', async () => {
    session.mockResolvedValue(admin);
    expect((await log(get('/api/admin/capture/log?days=30'))).status).toBe(200);
    expect(svc.captureLog).toHaveBeenCalledWith({ days: 30 });
    await gaps(get('/api/admin/capture/gaps?status=bogus'));
    expect(svc.listGaps).toHaveBeenLastCalledWith({ status: 'open' });
    await gaps(get('/api/admin/capture/gaps?status=all'));
    expect(svc.listGaps).toHaveBeenLastCalledWith({ status: 'all' });
    expect((await gapGet(get(`/api/admin/capture/gaps/${GID}`), { params: { id: GID } })).status).toBe(200);
    expect((await gapGet(get('/api/admin/capture/gaps/x'), { params: { id: 'x' } })).status).toBe(404);
  });

  it('dismiss / re-open is JSON-only and validated', async () => {
    session.mockResolvedValue(admin);
    expect((await gapPost(post(`/api/admin/capture/gaps/${GID}`, { action: 'dismiss' }, 'text/plain'), { params: { id: GID } })).status).toBe(415);
    expect((await gapPost(post(`/api/admin/capture/gaps/${GID}`, { action: 'delete' }), { params: { id: GID } })).status).toBe(422);
    expect(svc.setGapStatus).not.toHaveBeenCalled();
    expect((await gapPost(post(`/api/admin/capture/gaps/${GID}`, { action: 'dismiss' }), { params: { id: GID } })).status).toBe(200);
    expect(svc.setGapStatus).toHaveBeenCalledWith(admin, GID, 'dismiss');
  });

  it('cells: bbox inside the Philippines (≤ 2°) and a safe layer key', async () => {
    session.mockResolvedValue(admin);
    expect((await cells(get('/api/admin/capture/cells?bbox=14.4,120.8,14.5,120.9&layer=fnb_qsr'))).status).toBe(200);
    expect((await cells(get('/api/admin/capture/cells?bbox=14.4,120.8,14.5,120.9&layer=layer:anchors'))).status).toBe(200);
    expect((await cells(get('/api/admin/capture/cells?bbox=10,118,14.5,124&layer=fnb_qsr'))).status).toBe(422);
    expect((await cells(get("/api/admin/capture/cells?bbox=14.4,120.8,14.5,120.9&layer=x';drop"))).status).toBe(422);
    expect(svc.coverageCells).toHaveBeenCalledTimes(2);
  });

  it('plan (pre-flight) and OpenStreetMap status: admin only; plan is JSON-only and validated', async () => {
    const area = { kind: 'circle', lat: 14.43, lon: 120.88, radiusM: 700 };
    session.mockResolvedValue(analyst);
    expect((await plan(post('/api/admin/capture/plan', { area, layers: ['anchors'] }))).status).toBe(403);
    expect((await osmStatus()).status).toBe(403);
    session.mockResolvedValue(admin);
    expect((await plan(post('/api/admin/capture/plan', { area, layers: ['anchors'] }, 'text/plain'))).status).toBe(415);
    expect((await plan(post('/api/admin/capture/plan', { area, layers: [] }))).status).toBe(422);
    expect((await plan(post('/api/admin/capture/plan', { area, layers: ['anchors', 'v:fnb_qsr'] }))).status).toBe(200);
    const st = await (await osmStatus()).json();
    expect(st.data.window).toHaveProperty('offPeak');
    expect(svc.planCapture).toHaveBeenCalledTimes(1);
  });

  it('API refuses more than 3 business types per capture', () => {
    expect(SiteContextSchema.safeParse({ verticals: ['fnb_qsr', 'fnb_bakery', 'pharmacy'] }).success).toBe(true);
    expect(SiteContextSchema.safeParse({ verticals: ['fnb_qsr', 'fnb_bakery', 'pharmacy', 'salon'] }).success).toBe(false);
  });
});
