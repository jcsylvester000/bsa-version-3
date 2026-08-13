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
};
