import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { consumeGoogleQuota } from '@/lib/auth/apiQuota';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { geocodeAddress, hasGoogleKey } from '@/lib/geo/geocode';
import { recordDemand } from '@/lib/services/demand';
import { localGeocode } from '@/lib/geo/localGeocode';

// F-25: cap the address length so the paid Geocoding proxy can't be fed oversized input.
const schema = z.object({ address: z.string().min(2).max(200) });

/**
 * POST /api/geocode — turn a typed address into real lat/lon via Google (server-side
 * key). Used by the intake form so users type an address instead of coordinates.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  // Google when it is switched on; otherwise (or when it finds nothing) the offline fallback: typed
  // coordinates exactly, or a city/province centre flagged `approximate` (the user still pins the site).
  const google = hasGoogleKey() ? await geocodeAddress(parsed.data.address).catch(() => null) : null;
  const result = google ? { ...google, approximate: false } : localGeocode(parsed.data.address);
  if (!result) {
    return hasGoogleKey()
      ? fail({ code: 'not_found', message: 'No match found for that address in the Philippines.' }, 404)
      : fail({ code: 'geocoding_unavailable', message: 'Street-address search is off in database-only mode. Type a city or "lat, lon", or click the map to drop the pin.' }, 503);
  }

  // Demand tracking (admin → Capture Coverage → User demand): what was searched, where, and whether
  // BSA has place data there. Searches never queue a back-fill by themselves (an admin can).
  await recordDemand({ kind: 'search', userId: session.id, franchisorId: session.franchisorId, query: parsed.data.address, label: result.formattedAddress ?? null, lat: result.lat, lon: result.lon });

  return ok(result);
}
