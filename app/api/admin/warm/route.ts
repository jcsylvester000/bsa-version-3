import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { ok, fail, errors } from '@/lib/api/respond';
import { warmArea, NCR_CENTERS } from '@/lib/places/poiCache';

// Allow a longer server-side execution for the deliberate warm pass.
export const maxDuration = 60;

/**
 * POST /api/admin/warm — deliberately warm the on-demand POI cache for an area + vertical(s)
 * from OSM, WITHOUT any report waiting on it. This is the "cover as much data as possible"
 * tool: point it at an NCR area (or use the built-in NCR centre grid) and a set of verticals,
 * and it pulls + persists real establishments into the shared DB, stamping coverage.
 *
 * Body: { lat?, lon?, radiusM?, verticals?: string[], area?: 'ncr' }
 *  - area:'ncr' sweeps the NCR centre grid (Makati, BGC, Ortigas, QC, Manila, …) per vertical.
 *  - else lat/lon/radiusM warms one area.
 *
 * Bounded server-side (budget + cell cap inside warmArea) so it's kind to public Overpass.
 * Any signed-in user may call it; it only ever adds shared reference data.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const body = (await req.json().catch(() => ({}))) as {
    lat?: number; lon?: number; radiusM?: number; verticals?: string[]; area?: string;
    cellCap?: number; overallMs?: number;
  };
  const verticals = Array.isArray(body.verticals) && body.verticals.length ? body.verticals : ['fnb_qsr'];
  const radiusM = body.radiusM ?? 900;
  const cellCap = Math.min(12, Math.max(1, body.cellCap ?? 8));

  const targets: Array<{ lat: number; lon: number; label: string }> =
    body.area === 'ncr'
      ? NCR_CENTERS
      : body.lat != null && body.lon != null
        ? [{ lat: body.lat, lon: body.lon, label: 'custom' }]
        : [];

  if (!targets.length) return fail({ code: 'bad_request', message: 'Provide { area:"ncr" } or { lat, lon }.' }, 400);

  const results: Array<{ area: string; vertical: string; fetched: number; skipped: number; cells: number }> = [];
  let totalFetched = 0;
  // Per-request overall budget so the call returns before any client timeout (default 35s,
  // comfortably under a 45s client cap). Callers can shrink cellCap for faster returns.
  const overallDeadline = Date.now() + Math.min(50_000, Math.max(8_000, body.overallMs ?? 35_000));
  for (const t of targets) {
    for (const v of verticals) {
      if (Date.now() >= overallDeadline) break;
      const r = await warmArea(t.lat, t.lon, v, radiusM, { budgetMs: 30_000, cellCap });
      totalFetched += r.fetched;
      results.push({ area: t.label, vertical: v, ...r });
    }
  }

  return ok({ totalFetched, results });
}
