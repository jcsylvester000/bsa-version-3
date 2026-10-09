import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { consumeGoogleQuota } from '@/lib/auth/apiQuota';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { geocodeAddress, hasGoogleKey } from '@/lib/geo/geocode';
import { recordDemand } from '@/lib/services/demand';

// F-25: cap the address length so the paid Geocoding proxy can't be fed oversized input.
const schema = z.object({ address: z.string().min(2).max(200) });

/**
 * POST /api/geocode — turn a typed address into real lat/lon via Google (server-side
 * key). Used by the intake form so users type an address instead of coordinates.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  if (!hasGoogleKey()) {
    return fail({ code: 'geocoding_unavailable', message: 'Geocoding is not configured (no GOOGLE_API_KEY).' }, 503);
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  const result = await geocodeAddress(parsed.data.address);
  if (!result) return fail({ code: 'not_found', message: 'No match found for that address in the Philippines.' }, 404);

  // Demand tracking (admin → Capture Coverage → User demand): what was searched, where, and whether
  // BSA has place data there. Searches never queue a back-fill by themselves (an admin can).
  await recordDemand({ kind: 'search', userId: session.id, franchisorId: session.franchisorId, query: parsed.data.address, label: result.formattedAddress ?? null, lat: result.lat, lon: result.lon });

  return ok(result);
}
