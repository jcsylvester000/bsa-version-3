import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { nearbyForVertical, nearby, textSearch, hasPlacesKey } from '@/lib/places/placesService';
import { placeQueryForVertical } from '@/lib/places/placeTypes';

const schema = z.union([
  z.object({
    mode: z.literal('nearby'),
    lat: z.number(), lon: z.number(),
    vertical: z.string().optional(),
    types: z.array(z.string()).optional(),
    radiusM: z.number().int().min(100).max(5000).optional(),
    max: z.number().int().min(1).max(20).optional(),
  }),
  z.object({ mode: z.literal('text'), query: z.string().min(2), max: z.number().int().min(1).max(20).optional() }),
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
