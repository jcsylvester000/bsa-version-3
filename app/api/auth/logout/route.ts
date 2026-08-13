import { SESSION_COOKIE_NAME } from '@/lib/auth/auth';
import { ok } from '@/lib/api/respond';

export async function POST() {
  const res = ok({ loggedOut: true });
  res.cookies.set(SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 });
  return res;
}
