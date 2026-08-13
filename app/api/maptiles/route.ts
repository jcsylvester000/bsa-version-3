import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { ok, fail, errors } from '@/lib/api/respond';
import { placesLiveEnabled } from '@/lib/places/placesService';

/**
 * GET /api/maptiles — mint a Google Map Tiles API session token (server-side; the
 * GOOGLE_API_KEY never reaches the browser). The client uses the returned session
 * to fetch Google raster tiles through /api/maptiles/[z]/[x]/[y], which proxies to
 * Google with the key attached. This makes Google Maps the basemap in place of OSM.
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  // Google Map Tiles are billed per session + per tile. Gate on the live switch so the
  // map falls back to the free OpenStreetMap basemap unless PLACES_LIVE=1.
  const key = process.env.GOOGLE_API_KEY;
  if (!key || !placesLiveEnabled()) return fail({ code: 'maps_unavailable', message: 'Google Maps basemap disabled (using OpenStreetMap).' }, 503);

  const res = await fetch(`https://tile.googleapis.com/v1/createSession?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mapType: 'roadmap', language: 'en-US', region: 'PH' }),
    cache: 'no-store',
  });
  if (!res.ok) return fail({ code: 'maps_error', message: 'Could not start a Google Maps session.' }, 502);
  const data = (await res.json()) as { session: string; expiry: string };

  // Return the session token + a client tile URL template that proxies through us.
  return ok({
    session: data.session,
    expiry: data.expiry,
    tileUrlTemplate: `/api/maptiles/{z}/{x}/{y}?session=${encodeURIComponent(data.session)}`,
  });
}
