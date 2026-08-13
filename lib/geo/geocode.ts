/**
 * Server-side geocoding via the Google Maps Geocoding API. The API key lives only
 * on the server (GOOGLE_API_KEY) and never reaches the browser — the client calls
 * our /api/geocode route, which calls Google server-to-server.
 *
 * Results are clamped to Philippine bounds (the app's market). Returns null when
 * nothing sensible is found rather than guessing.
 */
import 'server-only';
import { inPhBounds } from '@/lib/ingest/normalize';
import { placesLiveEnabled } from '@/lib/places/placesService';

export interface GeocodeResult {
  lat: number;
  lon: number;
  formattedAddress: string;
  /** Google place types for the top match (e.g. 'street_address'). */
  types: string[];
}

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

// Geocoding rides the same live switch as Places — OFF unless PLACES_LIVE=1, so the
// intake form falls back to the map-pin (📍) instead of billing per address lookup.
export function hasGoogleKey(): boolean {
  return !!process.env.GOOGLE_API_KEY && placesLiveEnabled();
}

export async function geocodeAddress(query: string): Promise<GeocodeResult | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;
  const trimmed = query.trim();
  if (!trimmed) return null;

  const url = new URL(ENDPOINT);
  url.searchParams.set('address', trimmed);
  url.searchParams.set('key', key);
  // Bias to the Philippines.
  url.searchParams.set('region', 'ph');
  url.searchParams.set('components', 'country:PH');

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status: string;
    results?: Array<{
      geometry: { location: { lat: number; lng: number } };
      formatted_address: string;
      types: string[];
    }>;
  };
  if (data.status !== 'OK' || !data.results?.length) return null;

  const top = data.results[0];
  const lat = top.geometry.location.lat;
  const lon = top.geometry.location.lng;
  if (!inPhBounds(lat, lon)) return null;

  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    formattedAddress: top.formatted_address,
    types: top.types ?? [],
  };
}
