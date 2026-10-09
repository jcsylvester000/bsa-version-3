import { NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/respond';
import { runAutofill } from '@/lib/services/autofill';
import { cronAuthorized } from '@/lib/api/cron';

// One time-boxed pass of the back-fill queue (fetch ≤ ~20 s + run refresh).
export const maxDuration = 26;
export const dynamic = 'force-dynamic';

/**
 * POST /api/internal/autofill — called by the scheduled function (netlify/functions/autofill-cron.mjs)
 * every 10 minutes. Machine-to-machine only: no session; a shared secret in the Authorization header.
 * Public in middleware (no cookie) — this check is the only gate, and it fails closed.
 */
export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET) return fail({ code: 'not_configured', message: 'CRON_SECRET is not set.' }, 503);
  if (!cronAuthorized(req.headers.get('authorization'))) return fail({ code: 'unauthorized', message: 'Unauthorized.' }, 401);
  return ok(await runAutofill({ trigger: 'cron', budgetMs: 20_000 }));
}
