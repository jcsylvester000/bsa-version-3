import { NextRequest, NextResponse } from 'next/server';
import { getStorage } from '@/lib/storage';
import { verifyKey } from '@/lib/storage/signtoken';
import { errors } from '@/lib/api/respond';

/**
 * GET /api/files?key=...&exp=...&sig=...[&dl=1]
 * Serves a stored object ONLY with a valid, unexpired signed token — the local-fs
 * equivalent of a presigned bucket URL. No public hosting; no listing.
 */
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get('key');
  const exp = Number(req.nextUrl.searchParams.get('exp'));
  const sig = req.nextUrl.searchParams.get('sig');
  const asDownload = req.nextUrl.searchParams.get('dl') === '1';

  if (!key || !sig || !Number.isFinite(exp)) {
    return errors.notFound('File');
  }
  const now = Math.floor(Date.now() / 1000);
  if (!verifyKey(key, exp, sig, now)) {
    // Uniform 404 — don't distinguish "expired" from "bad signature" from "missing".
    return errors.notFound('File');
  }

  const obj = await getStorage().get(key);
  if (!obj) return errors.notFound('File');

  const filename = key.split('/').pop() ?? 'download';
  // Buffer → Uint8Array for the web Response body type.
  const bytes = new Uint8Array(obj.body);
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': obj.contentType,
      'Cache-Control': 'private, no-store',
      ...(asDownload ? { 'Content-Disposition': `attachment; filename="${filename}"` } : {}),
    },
  });
}
