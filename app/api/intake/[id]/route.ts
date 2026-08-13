import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessRun } from '@/lib/auth/auth';
import { isUuid } from '@/lib/util/uuid';
import { ok, errors } from '@/lib/api/respond';

/**
 * GET /api/intake/[id] — the original inputs of an intake (for edit-and-rerun) plus its
 * version lineage. Used to preload the wizard with a previous run's inputs and to show
 * version history. Access-checked (own run / shared brand).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return errors.unauthorized();
  if (!isUuid(params.id)) return errors.notFound('Intake'); // guard: non-UUID → 404, not a DB 500

  const intake = await prisma.intakeSubmission.findUnique({
    where: { id: params.id },
    include: {
      franchisor: { select: { id: true, brandName: true } },
      run: { select: { id: true, sites: { select: { label: true, address: true, city: true, lat: true, lon: true, siteType: true } } } },
    },
  });
  if (!intake) return errors.notFound('Intake');
  // The intake carries its own creator + brand — reuse the run ownership rule so only
  // the creator (or staff, or the owning franchisor for legacy rows) can load it back
  // for edit-and-rerun.
  if (!canAccessRun(session, { createdByUserId: intake.createdByUserId, franchisorId: intake.franchisorId })) return errors.forbidden();

  // Reconstruct the flat `sections` map (a…k + land/mall/units) from the stored columns.
  const sections: Record<string, unknown> = {};
  const S = intake as unknown as Record<string, unknown>;
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'K'] as const) {
    const v = S[`section${k}`];
    if (v != null) {
      // sectionA/B may be objects; the wizard stores a/b as plain strings — flatten sensibly.
      if (typeof v === 'object') {
        const o = v as Record<string, unknown>;
        sections[k.toLowerCase()] = (o.text as string) ?? (o.brand as string) ?? (o.concept as string) ?? JSON.stringify(v);
        if (k === 'B' && o.income) sections.b2 = o.income;
      } else {
        sections[k.toLowerCase()] = v;
      }
    }
  }
  if ((S.sectionH as { landParcel?: string })?.landParcel) sections.land = (S.sectionH as { landParcel?: string }).landParcel;
  if ((S.sectionI as { mallTier?: string })?.mallTier) sections.mall = (S.sectionI as { mallTier?: string }).mallTier;
  if ((S.sectionJ as { capacityUnits?: string })?.capacityUnits) sections.units = (S.sectionJ as { capacityUnits?: string }).capacityUnits;

  // Outlets for this franchisor (the intake's outlet master).
  const outlets = await prisma.outlet.findMany({
    where: { franchisorId: intake.franchisorId },
    select: { outletName: true, format: true, lat: true, lon: true, monthlySalesPhp: true },
  });

  // Version lineage: the root + all its versions, newest first.
  const rootId = intake.parentIntakeId ?? intake.id;
  const versions = await prisma.intakeSubmission.findMany({
    where: { OR: [{ id: rootId }, { parentIntakeId: rootId }] },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, createdAt: true, run: { select: { id: true, status: true } } },
  });

  return ok({
    id: intake.id,
    version: intake.version,
    parentIntakeId: intake.parentIntakeId,
    rootId,
    franchisor: intake.franchisor,
    vertical: intake.vertical,
    sections,
    outlets: outlets.map((o) => ({ outletName: o.outletName, format: o.format, lat: String(o.lat), lon: String(o.lon), monthlySalesPhp: o.monthlySalesPhp != null ? String(o.monthlySalesPhp) : '' })),
    candidateSites: (intake.run?.sites ?? []).map((s) => ({ label: s.label, address: s.address ?? '', city: s.city ?? '', lat: String(s.lat), lon: String(s.lon), siteType: s.siteType ?? 'inline' })),
    versions: versions.map((v) => ({ intakeId: v.id, version: v.version, createdAt: v.createdAt, runId: v.run?.id ?? null, status: v.run?.status ?? null })),
  });
}
