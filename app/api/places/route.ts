import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { consumeGoogleQuota } from '@/lib/auth/apiQuota';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { nearbyForVertical, nearby, textSearch, hasPlacesKey } from '@/lib/places/placesService';
import { placeQueryForVertical } from '@/lib/places/placeTypes';

// F-25: tight input bounds. Coordinates must be inside the Philippines' bounding box, and every
// free-text/array field is length-capped so the proxy can't be driven with junk or oversized inputs.
const PH_LAT = z.number().min(4.0).max(21.5);
const PH_LON = z.number().min(116.0).max(127.0);
const schema = z.union([
  z.object({
    mode: z.literal('nearby'),
    lat: PH_LAT, lon: PH_LON,
    vertical: z.string().max(40).optional(),
    types: z.array(z.string().max(40)).max(10).optional(),
    radiusM: z.number().int().min(100).max(5000).optional(),
    max: z.number().int().min(1).max(20).optional(),
  }),
  z.object({ mode: z.literal('text'), query: z.string().min(2).max(200), max: z.number().int().min(1).max(20).optional() }),
]);

/**
 * POST /api/places — pull REAL establishments from Google Places (server-side key).
 * mode "nearby": competitors near a point (by vertical or explicit types).
 * mode "text": find a named brand/category across the Philippines.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!hasPlacesKey()) return fail({ code: 'places_unavailable', message: 'Google Places is not configured.' }, 503);

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);

  // F-25: per-user daily budget for the paid Places API.
  const quota = await consumeGoogleQuota(session.id);
  if (!quota.allowed) return errors.tooMany(quota.retryAfterSeconds, 'Daily map-search limit reached. Please try again tomorrow.');

  if (parsed.data.mode === 'text') {
    const places = await textSearch(parsed.data.query, { max: parsed.data.max });
    return ok({ places, label: parsed.data.query });
  }

  const { lat, lon, vertical, types, radiusM, max } = parsed.data;
  const label = vertical ? placeQueryForVertical(vertical).label : 'establishments';
  const places = types?.length
    ? await nearby(lat, lon, types, `t:${types.join(',')}`, { radiusM, max })
    : await nearbyForVertical(lat, lon, vertical ?? 'other', { radiusM, max });
  return ok({ places, label });
}
