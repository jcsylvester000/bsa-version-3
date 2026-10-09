import { NextRequest } from 'next/server';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { requireAdmin, isJson, captureErrorResponse, BoundariesBody } from '@/lib/api/adminCapture';
import { loadBoundariesForArea } from '@/lib/geo/boundaryOnDemand';
import { checkLimit, recordAttempt } from '@/lib/auth/rateLimit';
import { audit } from '@/lib/audit/audit';
import { isUuid } from '@/lib/util/uuid';

// Downloads 1–4 city files (~100–400 KB each) and writes their barangays.
export const maxDuration = 26;

const LIMIT = { max: 60, windowMs: 60 * 60_000 };

/**
 * POST /api/admin/capture/boundaries { area } — load the PSA barangay boundaries for the cities /
 * municipalities this capture area touches (≤ 4), and tag places already saved there. Idempotent:
 * cities already loaded are skipped. JSON only. Admin only, rate-limited, audited.
 */
export async function POST(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isJson(req)) return fail({ code: 'unsupported_media_type', message: 'Send JSON.' }, 415);
  const parsed = BoundariesBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return failValidation(parsed.error);

  const lim = await checkLimit('capture_boundaries', 'admin_capture', g.user.id, LIMIT);
  if (lim.limited) return errors.tooMany(lim.retryAfterSeconds, 'Boundary loads limit reached for this hour. Try again later.');
  await recordAttempt('capture_boundaries', 'admin_capture', g.user.id);

  try {
    const r = await loadBoundariesForArea(parsed.data.area);
    await audit({ actorId: isUuid(g.user.id) ? g.user.id : null, action: 'admin_boundary.load', entity: 'admin_boundary', entityId: null, meta: { cities: r.cities, barangays: r.barangaysLoaded, tagged: r.placesTagged } });
    if (!r.cities.length) return fail({ code: 'outside_ph', message: 'No Philippine city or municipality found at this spot.' }, 422);
    if (r.cities.every((c) => c.status === 'failed')) return fail({ code: 'boundary_source_unavailable', message: 'The boundary files could not be downloaded right now. Try again in a minute, or tick “Capture anyway”.' }, 502);
    return ok(r);
  } catch (e) {
    return captureErrorResponse(e);
  }
}
