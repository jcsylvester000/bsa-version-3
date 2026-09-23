import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { isAdmin } from '@/lib/auth/auth';
import { z } from 'zod';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { warmArea, NCR_CENTERS } from '@/lib/places/poiCache';

const WarmBody = z.object({
  lat: z.number().min(4).max(21).optional(), // PH bounds
  lon: z.number().min(116).max(127).optional(),
  radiusM: z.number().int().min(100).max(5_000).optional(),
  verticals: z.array(z.string().regex(/^[a-z_]{2,40}$/)).max(25).optional(),
  area: z.enum(['ncr']).optional(),
  cellCap: z.number().int().min(1).max(12).optional(),
  overallMs: z.number().int().min(1_000).max(50_000).optional(),
});

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
 * ADMIN ONLY: it triggers bounded-but-heavy outbound Overpass traffic on the server.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!isAdmin(session)) return errors.forbidden();

  const parsed = WarmBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return failValidation(parsed.error);
  const body = parsed.data;
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
