import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { BRAND_VERTICALS as CANDIDATES } from '@/lib/brands/brandVertical';
import { ok, errors } from '@/lib/api/respond';

/**
 * Comparable-brand picker source. Returns well-known chains — grouped by concept
 * category and each mapped to the intake vertical it best fits (from the shared
 * brand→vertical map) — but ONLY the ones that actually have establishments in the
 * database, with a live count. An independent operator picks the brand closest to
 * theirs so the scoring (competitor discrimination, daypart, lease corridor) adapts to
 * that concept. All from the DB, no Google calls.
 */

export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const out: Array<{ brand: string; category: string; vertical: string; count: number }> = [];
  for (const c of CANDIDATES) {
    const rows = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM poi WHERE name ILIKE ${'%' + c.match + '%'}`;
    const n = rows[0]?.n ?? 0;
    if (n > 0) out.push({ brand: c.brand, category: c.category, vertical: c.vertical, count: n });
  }
  // Group for the UI.
  const groups: Record<string, Array<{ brand: string; vertical: string; count: number }>> = {};
  for (const b of out) {
    (groups[b.category] ??= []).push({ brand: b.brand, vertical: b.vertical, count: b.count });
  }
  return ok({
    groups: Object.entries(groups).map(([category, brands]) => ({ category, brands })),
    total: out.length,
  });
}
