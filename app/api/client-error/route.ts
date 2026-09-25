import { NextRequest } from 'next/server';
import { z } from 'zod';
import { captureException } from '@/lib/monitoring/report';
import { ok } from '@/lib/api/respond';

/**
 * POST /api/client-error — the browser error boundary reports uncaught client errors here (F-51) so
 * they reach the same monitoring seam as server errors. Public (errors can happen on the login page)
 * but strictly bounded: fields are length-capped and it only ever logs — no reads, no writes, no
 * secrets. Always answers 200 so reporting never surfaces its own failure to the user.
 */
const schema = z.object({
  message: z.string().max(500).optional(),
  digest: z.string().max(120).optional(),
  route: z.string().max(200).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    await captureException(new Error(parsed.data.message || 'client error'), {
      ref: parsed.data.digest,
      code: 'client_error',
      route: parsed.data.route,
    });
  }
  return ok({ received: true });
}
