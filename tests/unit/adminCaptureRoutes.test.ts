/**
 * Admin capture routes are ADMIN ONLY at the API boundary (not just a hidden menu item), accept
 * JSON only, validate before doing any work, and never reach the service on a rejected request.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const session = vi.fn();
vi.mock('@/lib/auth/session', () => ({ getSession: () => session() }));
vi.mock('@/lib/auth/rateLimit', () => ({
  checkLimit: vi.fn(async () => ({ limited: false, retryAfterSeconds: 0 })),
  recordAttempt: vi.fn(async () => undefined),
}));
const svc = {
  previewArea: vi.fn(async () => ({ batchId: 'b', staged: 3, skipped: {}, notes: [] })),
  saveCapture: vi.fn(async () => ({ batchId: 'b', saved: 3, inBsa: 3, psgcTagged: 3, skippedExisting: 0, coverageStamped: 0 })),
  importNavigator: vi.fn(async () => ({ batchId: 'b', staged: 1, stats: {} })),
  siteReadiness: vi.fn(async () => ({ summary: {} })),
};
vi.mock('@/lib/services/capture', () => ({
  CaptureError: class CaptureError extends Error { constructor(public code: string, m: string, public status = 400) { super(m); } },
  previewArea: (...a: unknown[]) => svc.previewArea(...(a as [])),
  saveCapture: (...a: unknown[]) => svc.saveCapture(...(a as [])),
  importNavigator: (...a: unknown[]) => svc.importNavigator(...(a as [])),
  siteReadiness: (...a: unknown[]) => svc.siteReadiness(...(a as [])),
}));

import { POST as preview } from '@/app/api/admin/capture/preview/route';
import { POST as save } from '@/app/api/admin/capture/save/route';
import { POST as importRoute } from '@/app/api/admin/capture/import/route';
import { GET as readiness } from '@/app/api/admin/capture/readiness/route';

const admin = { id: '11111111-1111-4111-8111-111111111111', email: 'a@grid', role: 'admin', franchisorId: null };
const analyst = { ...admin, role: 'analyst' };
const broker = { ...admin, role: 'broker' };
const area = { kind: 'circle', lat: 14.2846, lon: 121.0966, radiusM: 800 };
const item = { osmRef: 'node/1', receipt: 'x'.repeat(32), name: 'Jollibee Nuvali', kind: 'amenity=fast_food', category: 'competitor', lat: 14.2846, lon: 121.0966, origin: 'osm' };
const saveBody = { source: 'osm', items: [item] };

function req(url: string, body?: unknown, contentType = 'application/json') {
  return new NextRequest(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => { session.mockReset(); Object.values(svc).forEach((f) => f.mockClear()); });

describe('admin capture routes', () => {
  it('401 without a session, 403 for analysts and brokers — service never called', async () => {
    session.mockResolvedValue(null);
    expect((await preview(req('/api/admin/capture/preview', { area, layers: ['anchors'] }))).status).toBe(401);
    for (const u of [analyst, broker]) {
      session.mockResolvedValue(u);
      expect((await preview(req('/api/admin/capture/preview', { area, layers: ['anchors'] }))).status).toBe(403);
      expect((await save(req('/api/admin/capture/save', saveBody))).status).toBe(403);
      expect((await importRoute(req('/api/admin/capture/import', { checkpoints: [], routes: [] }))).status).toBe(403);
    }
    expect(svc.previewArea).not.toHaveBeenCalled();
    expect(svc.saveCapture).not.toHaveBeenCalled();
    expect(svc.importNavigator).not.toHaveBeenCalled();
  });

  it('rejects non-JSON bodies, unknown layers and areas outside the Philippines', async () => {
    session.mockResolvedValue(admin);
    expect((await preview(req('/api/admin/capture/preview', 'a=b', 'application/x-www-form-urlencoded'))).status).toBe(415);
    expect((await preview(req('/api/admin/capture/preview', { area, layers: ['v:"];out;'] }))).status).toBe(422);
    expect((await preview(req('/api/admin/capture/preview', { area: { ...area, lat: 35.6 }, layers: ['anchors'] }))).status).toBe(422);
    expect(svc.previewArea).not.toHaveBeenCalled();
  });

  it('admin with a valid request reaches the service', async () => {
    session.mockResolvedValue(admin);
    const r = await preview(req('/api/admin/capture/preview', { area, layers: ['anchors', 'v:fnb_qsr'] }));
    expect(r.status).toBe(200);
    expect(svc.previewArea).toHaveBeenCalledOnce();
    expect((await save(req('/api/admin/capture/save', saveBody))).status).toBe(200);
    expect(svc.saveCapture).toHaveBeenCalledOnce();
  });

  it('save validates every place before anything is written', async () => {
    session.mockResolvedValue(admin);
    expect((await save(req('/api/admin/capture/save', { source: 'osm', items: [] }))).status).toBe(422);
    expect((await save(req('/api/admin/capture/save', { source: 'osm', items: [{ ...item, lat: 35.6 }] }))).status).toBe(422);
    expect((await save(req('/api/admin/capture/save', { source: 'osm', items: [{ ...item, osmRef: "node/1'; drop" }] }))).status).toBe(422);
    expect((await save(req('/api/admin/capture/save', { source: 'osm', items: [{ ...item, category: 'bogus' }] }))).status).toBe(422);
    expect((await save(req('/api/admin/capture/save', 'a=b', 'application/x-www-form-urlencoded'))).status).toBe(415);
    expect(svc.saveCapture).not.toHaveBeenCalled();
  });

  it('import refuses oversized and non-JSON files', async () => {
    session.mockResolvedValue(admin);
    const big = req('/api/admin/capture/import', '{"checkpoints":[],"routes":[],"pad":"' + 'x'.repeat(10 * 1024 * 1024) + '"}');
    expect((await importRoute(big)).status).toBe(413);
    expect((await importRoute(req('/api/admin/capture/import', 'not json'))).status).toBe(422);
    expect(svc.importNavigator).not.toHaveBeenCalled();
  });

  it('readiness is admin-only and validates the site + business type', async () => {
    const get = (qs: string) => new NextRequest(`http://localhost/api/admin/capture/readiness?${qs}`);
    session.mockResolvedValue(broker);
    expect((await readiness(get('lat=14.28&lon=121.09'))).status).toBe(403);
    session.mockResolvedValue(admin);
    expect((await readiness(get('lat=35.6&lon=139.7'))).status).toBe(422);
    expect((await readiness(get('lat=14.28&lon=121.09&vertical=bogus'))).status).toBe(422);
    expect(svc.siteReadiness).not.toHaveBeenCalled();
    expect((await readiness(get('lat=14.28&lon=121.09&vertical=fnb_qsr&format=mall&radiusM=1500&brand='))).status).toBe(200);
    expect(svc.siteReadiness).toHaveBeenCalledWith(expect.objectContaining({ lat: 14.28, lon: 121.09, vertical: 'fnb_qsr', format: 'mall', radiusM: 1500 }));
  });

  it('save accepts the Territory Guard site context and rejects an unknown business type', async () => {
    session.mockResolvedValue(admin);
    const ctx = { site: { lat: 14.2846, lon: 121.0966 }, vertical: 'fnb_qsr', brand: 'Jollibee', format: 'inline' };
    expect((await save(req('/api/admin/capture/save', { ...saveBody, area, layers: ['v:fnb_qsr'], context: ctx }))).status).toBe(200);
    expect((await save(req('/api/admin/capture/save', { ...saveBody, context: { ...ctx, vertical: 'nope' } }))).status).toBe(422);
  });
});
