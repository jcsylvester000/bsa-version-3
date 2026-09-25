/**
 * Account / catalog service (F-47). One data path for the small profile + brand-catalog reads the
 * settings and intake pages need, so those pages no longer touch Prisma directly.
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { visibleFranchisorWhere, type SessionUser } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { safeQuery } from '@/lib/db/safeQuery';

/** Member-since timestamp for a real account; null for demo/mock (no DB row). */
export async function getAccountCreatedAt(session: SessionUser): Promise<Date | null> {
  if (!isUuid(session.id)) return null;
  const row = await prisma.appUser.findUnique({ where: { id: session.id }, select: { createdAt: true } }).catch(() => null);
  return row?.createdAt ?? null;
}

/** Brands the session may pick in the intake dropdown (same visibility rule as /api/franchisors).
 *  Resilient: returns `dbDown` so the caller can fall back to mock mode. */
export async function listVisibleFranchisors(session: SessionUser): Promise<{ franchisors: Array<{ id: string; brandName: string }>; dbDown: boolean }> {
  const { data, dbDown } = await safeQuery(
    () => prisma.franchisor.findMany({ where: visibleFranchisorWhere(session), select: { id: true, brandName: true }, orderBy: { brandName: 'asc' } }),
    [] as Array<{ id: string; brandName: string }>,
  );
  return { franchisors: data, dbDown };
}
