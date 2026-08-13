import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { errors } from '@/lib/api/respond';
import { placesLiveEnabled } from '@/lib/places/placesService';

/**
 * GET /api/maptiles/[z]/[x]/[y]?session=... — proxy a single Google Maps raster tile.
 * The GOOGLE_API_KEY is attached here, server-side, so it never reaches the browser.
 * Tiles are cacheable (immutable per z/x/y/session).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { z: string; x: string; y: string } },
) {
  const auth = await getSession();
  if (!auth) return errors.unauthorized();

  const key = process.env.GOOGLE_API_KEY;
  const session = req.nextUrl.searchParams.get('session');
  if (!key || !session || !placesLiveEnabled()) return errors.notFound('Tile');

  const { z, x, y } = params;
  // Basic bounds sanity to avoid abuse.
  if (!/^\d{1,2}$/.test(z) || !/^\d{1,7}$/.test(x) || !/^\d{1,7}$/.test(y)) {
    return errors.notFound('Tile');
  }

  const url = `https://tile.googleapis.com/v1/2dtiles/${z}/${x}/${y}?session=${encodeURIComponent(session)}&key=${key}`;
  const res = await fetch(url, { cache: 'force-cache' });
  if (!res.ok) return errors.notFound('Tile');

  const buf = Buffer.from(await res.arrayBuffer());
  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'public, max-age=86400, immutable',
    },
  });
}
