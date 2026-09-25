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

  // F-25: validate the tile coordinates properly — z in [0,22] and x/y within the 2^z grid for that
  // zoom — so the proxy can only ever request a real Google tile, never an arbitrary crafted path.
  const z = Number(params.z), x = Number(params.x), y = Number(params.y);
  const zoomOk = Number.isInteger(z) && z >= 0 && z <= 22;
  const max = zoomOk ? 2 ** z : 0;
  if (!zoomOk || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= max || y >= max) {
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
      // F-29: authenticated response — browser cache only, never a shared/CDN cache.
      'Cache-Control': 'private, max-age=86400',
    },
  });
}
