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
  commitBatch: vi.fn(async () => ({ committed: 3, psgcTagged: 3, skippedExisting: 0 })),
  importNavigator: vi.fn(async () => ({ batchId: 'b', staged: 1, stats: {} })),
};
vi.mock('@/lib/services/capture', () => ({
  CaptureError: class CaptureError extends Error { constructor(public code: string, m: string, public status = 400) { super(m); } },
  previewArea: (...a: unknown[]) => svc.previewArea(...(a as [])),
  commitBatch: (...a: unknown[]) => svc.commitBatch(...(a as [])),
  importNavigator: (...a: unknown[]) => svc.importNavigator(...(a as [])),
}));

import { POST as preview } from '@/app/api/admin/capture/preview/route';
import { POST as commit } from '@/app/api/admin/capture/batches/[id]/commit/route';
import { POST as importRoute } from '@/app/api/admin/capture/import/route';

const admin = { id: '11111111-1111-4111-8111-111111111111', email: 'a@grid', role: 'admin', franchisorId: null };
const analyst = { ...admin, role: 'analyst' };
const broker = { ...admin, role: 'broker' };
const area = { kind: 'circle', lat: 14.2846, lon: 121.0966, radiusM: 800 };
const BATCH = '22222222-2222-4222-8222-222222222222';

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
      expect((await commit(req(`/api/admin/capture/batches/${BATCH}/commit`), { params: { id: BATCH } })).status).toBe(403);
      expect((await importRoute(req('/api/admin/capture/import', { checkpoints: [], routes: [] }))).status).toBe(403);
    }
    expect(svc.previewArea).not.toHaveBeenCalled();
    expect(svc.commitBatch).not.toHaveBeenCalled();
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
    const c = await commit(req(`/api/admin/capture/batches/${BATCH}/commit`), { params: { id: BATCH } });
    expect(c.status).toBe(200);
  });

  it('commit 404s a non-UUID batch id without touching the DB', async () => {
    session.mockResolvedValue(admin);
    expect((await commit(req('/api/admin/capture/batches/x/commit'), { params: { id: "1' OR '1'='1" } })).status).toBe(404);
    expect(svc.commitBatch).not.toHaveBeenCalled();
  });

  it('import refuses oversized and non-JSON files', async () => {
    session.mockResolvedValue(admin);
    const big = req('/api/admin/capture/import', '{"checkpoints":[],"routes":[],"pad":"' + 'x'.repeat(10 * 1024 * 1024) + '"}');
    expect((await importRoute(big)).status).toBe(413);
    expect((await importRoute(req('/api/admin/capture/import', 'not json'))).status).toBe(422);
    expect(svc.importNavigator).not.toHaveBeenCalled();
  });
});
