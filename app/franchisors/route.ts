import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { resolveBrandVertical } from '@/lib/brands/brandVertical';
import { ok, failValidation, errors } from '@/lib/api/respond';

/**
 * Franchise-brand list + create.
 *
 * GET  — the brands available to pick for an intake: the full shared catalog (so a
 *        user can analyse any well-known brand) grouped by sector. Staff see all;
 *        others still get the catalog plus their own scoped franchisor.
 * POST — create a NEW franchise brand from the intake screen. It's created as a normal
 *        franchisor record so it persists and can be selected/run like any other.
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const rows = await prisma.franchisor.findMany({
    select: { id: true, brandName: true, sector: true, subCategory: true, requirements: true },
    orderBy: [{ sector: 'asc' }, { brandName: 'asc' }],
  });
  // De-dupe by brand name (some brands were seeded more than once historically).
  const seen = new Set<string>();
  const brands = rows.filter((r) => {
    const k = r.brandName.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const groups: Record<string, Array<{ id: string; brandName: string; subCategory: string | null; vertical: string | null }>> = {};
  for (const b of brands) (groups[b.sector] ??= []).push({
    id: b.id,
    brandName: b.brandName,
    subCategory: b.subCategory,
    // Attach the mapped vertical so the intake dropdown can filter to the chosen vertical.
    // Order of authority: the brand's imported requirements template carries an explicit,
    // curated `vertical` (most reliable — set per brand from the intelligence matrices);
    // fall back to the name map → sub-category text for brands with no template.
    vertical: verticalFromRequirements(b.requirements) ?? resolveBrandVertical(b.brandName, b.subCategory),
  });

  return ok({
    groups: Object.entries(groups).map(([sector, items]) => ({ sector, brands: items })),
    total: brands.length,
  });
}

/** The authoritative vertical stored inside a brand's requirements template, if any.
 *  Guards against malformed JSON and unknown vertical strings. */
const VALID_VERTICALS = new Set([
  'fnb_qsr', 'fnb_cafe', 'fnb_bakery', 'retail_apparel', 'retail_specialty', 'services_salon',
  'services_spa', 'services_fitness', 'services_laundry', 'convenience', 'remittance', 'pharmacy',
  'diagnostics', 'fuel', 'automotive', 'hotel', 'education', 'other',
]);
function verticalFromRequirements(requirements: unknown): string | null {
  if (requirements && typeof requirements === 'object' && 'vertical' in requirements) {
    const v = (requirements as { vertical?: unknown }).vertical;
    if (typeof v === 'string' && VALID_VERTICALS.has(v)) return v;
  }
  return null;
}

const createSchema = z.object({
  brandName: z.string().min(2).max(120),
  sector: z.enum(['FnB', 'Retail', 'Services']),
  subCategory: z.string().max(120).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);
  const { brandName, sector, subCategory } = parsed.data;

  // Reuse an existing brand of the same name rather than duplicating.
  const existing = await prisma.franchisor.findFirst({ where: { brandName } });
  if (existing) {
    return ok({ id: existing.id, brandName: existing.brandName, created: false });
  }
  const created = await prisma.franchisor.create({
    data: { brandName, sector, subCategory: subCategory || null, positioning: `Added via intake by ${session.email}` },
  });
  return ok({ id: created.id, brandName: created.brandName, created: true }, { status: 201 });
}
