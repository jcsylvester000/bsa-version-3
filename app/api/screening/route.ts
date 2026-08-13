import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { screenBrands, type BrandInput } from '@/lib/modules/franchiseScreening';
import type { FranchiseRequirements } from '@/lib/modules/franchiseTemplate';
import { ok, failValidation, errors } from '@/lib/api/respond';

export const dynamic = 'force-dynamic';

/**
 * Load PFA Allied members (suppliers/vendors) from the data file and shape them as
 * screening rows. They are NOT franchise offers — kept out of the Franchisor table so
 * they never pollute the intake brand picker — but the buyer can still see them in the
 * screening list (tagged "Supplier", de-prioritized, findable via the Source filter).
 * A missing/unreadable file just yields no suppliers; it never breaks screening.
 */
interface AlliedMember {
  member: string; businessType?: string | null; contact?: string | null;
  email?: string | null; website?: string | null; dataset?: string | null;
  memberType?: string | null; truthLayer?: string | null; source?: string | null;
}
async function loadAlliedMembers(): Promise<BrandInput[]> {
  try {
    const p = path.join(process.cwd(), 'prisma', 'data', 'alliedMembers.real.json');
    const raw = await fs.readFile(p, 'utf-8');
    const list = JSON.parse(raw) as AlliedMember[];
    return list.map((a) => ({
      brand: a.member,
      requirements: {
        brand: a.member,
        category: a.businessType ?? 'Allied member',
        vertical: 'other',
        franchisor: a.member,
        memberType: 'supplier',
        dataset: a.dataset ?? 'PFA',
        truthLayer: a.truthLayer ?? 'Verified',
        source: a.source ?? 'PFA Members Directory — Allied Members List',
      } as FranchiseRequirements,
    }));
  } catch {
    return [];
  }
}

/**
 * POST /api/screening — the Franchise Screening endpoint.
 *
 * Takes a buyer's budget (+ optional floor area and vertical filter) and returns a ranked,
 * comparable shortlist of franchise brands from the standardized requirements matrix stored
 * on each Franchisor row. Deterministic ranking lives in lib/modules/franchiseScreening.ts;
 * this route only fetches, screens, and shapes the response. No AI, no external calls.
 */
const Body = z.object({
  budgetPhp: z.number().positive().nullable().optional(),
  floorAreaSqm: z.number().positive().nullable().optional(),
  vertical: z.string().nullable().optional(),
  limit: z.number().int().positive().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  let json: unknown;
  try { json = await req.json(); } catch { json = {}; }
  const parsed = Body.safeParse(json ?? {});
  if (!parsed.success) return failValidation(parsed.error);
  // Default limit is high: the client fetches the whole catalogue once and then filters,
  // sorts, and paginates in the browser, so the endpoint should return everything.
  const { budgetPhp = null, floorAreaSqm = null, vertical = null, limit = 500 } = parsed.data;

  // Pull every brand that carries a requirements template. De-dup by brand name (some
  // brands were seeded more than once historically).
  const rows = await prisma.franchisor.findMany({
    where: { NOT: { requirements: { equals: Prisma.JsonNull } } },
    select: { brandName: true, requirements: true, subCategory: true },
    orderBy: { brandName: 'asc' },
  });

  const seen = new Set<string>();
  const brands: BrandInput[] = [];
  for (const r of rows) {
    if (!r.requirements) continue;
    const key = r.brandName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    brands.push({ brand: r.brandName, requirements: r.requirements as unknown as FranchiseRequirements });
  }

  // Append PFA Allied members (suppliers) that aren't already present as a brand. They
  // rank last (score 0) and never distort the franchise shortlist.
  const suppliers = await loadAlliedMembers();
  const franchiseCount = brands.length;
  for (const s of suppliers) {
    const key = s.brand.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    brands.push(s);
  }

  const ranked = screenBrands(brands, { budgetPhp, floorAreaSqm, vertical }).slice(0, limit);

  return ok({
    input: { budgetPhp, floorAreaSqm, vertical },
    total: franchiseCount,
    suppliers: suppliers.length,
    returned: ranked.length,
    brands: ranked,
  });
}
