/**
 * API response helpers — the single consistent envelope for every route handler.
 * Business logic lives in lib/; routes stay thin: validate → call lib → shape.
 */
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import type { ApiError } from '@/types/api';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function fail(error: ApiError, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

/** Turn a ZodError into the standard field-level error envelope. */
export function failValidation(err: ZodError) {
  return fail(
    {
      code: 'validation_error',
      message: 'One or more fields are invalid.',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    },
    422,
  );
}

export const errors = {
  unauthorized: () => fail({ code: 'unauthorized', message: 'Authentication required.' }, 401),
  forbidden: () => fail({ code: 'forbidden', message: 'You do not have access to this resource.' }, 403),
  notFound: (what = 'Resource') => fail({ code: 'not_found', message: `${what} not found.` }, 404),
  server: (message = 'Something went wrong.') => fail({ code: 'server_error', message }, 500),
  tooMany: (retryAfterSeconds: number, message = 'Too many attempts. Please wait and try again.') => {
    const res = fail({ code: 'rate_limited', message }, 429);
    res.headers.set('Retry-After', String(retryAfterSeconds));
    return res;
  },
};

/**
 * CSRF guard for body-less POST mutations (they can't rely on "JSON only"): the request must come
 * from this site. Browsers send `Sec-Fetch-Site` on every fetch; older ones send `Origin`. A request
 * with neither (curl, server-to-server) is allowed — cookies are SameSite=Lax and it carries no
 * ambient browser credentials. Returns a 403 response to send, or null when the request is fine.
 */
export function crossSiteBlock(req: Request): Response | null {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return fail({ code: 'forbidden', message: 'Cross-site request blocked.' }, 403);
  const origin = req.headers.get('origin');
  if (!site && origin) {
    try {
      if (new URL(origin).host !== req.headers.get('host')) return fail({ code: 'forbidden', message: 'Cross-site request blocked.' }, 403);
    } catch {
      return fail({ code: 'forbidden', message: 'Cross-site request blocked.' }, 403);
    }
  }
  return null;
}
