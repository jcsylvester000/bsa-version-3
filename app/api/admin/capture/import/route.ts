import { NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/respond';
import { requireAdmin, isJson, captureErrorResponse } from '@/lib/api/adminCapture';
import { importNavigator } from '@/lib/services/capture';
import { MAX_IMPORT_BYTES, NavigatorFileError } from '@/lib/capture/navigatorFile';

/**
 * POST /api/admin/capture/import — stage a Grid Navigator session file (.gridnav.json) as a DRAFT
 * batch. The body is the file's JSON; `x-file-name` carries its name (display only). Capped at
 * 10 MB — save the session WITHOUT map tiles. Tiles, routes and shapes are ignored. Admin only.
 */
export async function POST(req: NextRequest) {
  const g = await requireAdmin();
  if ('res' in g) return g.res;
  if (!isJson(req)) return fail({ code: 'unsupported_media_type', message: 'Upload the .gridnav.json file as JSON.' }, 415);
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_IMPORT_BYTES) return tooBig();

  const text = await req.text();
  if (text.length > MAX_IMPORT_BYTES) return tooBig();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return fail({ code: 'bad_file', message: 'That file is not valid JSON.' }, 422); }

  try {
    return ok(await importNavigator(g.user, raw, req.headers.get('x-file-name') ?? ''));
  } catch (e) {
    if (e instanceof NavigatorFileError) return fail({ code: 'bad_file', message: e.message }, 422);
    return captureErrorResponse(e);
  }
}

function tooBig() {
  return fail({ code: 'file_too_large', message: 'File is larger than 10 MB. In Grid Navigator, save the session without cached map tiles and import that file.' }, 413);
}
