import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canAccessFranchisor } from '@/lib/auth/auth';
import { isMockUser } from '@/lib/auth/mockUsers';
import { intakeSubmitSchema } from '@/lib/validation/schemas';
import { computeCompleteness, REQUIRED_SECTIONS } from '@/lib/modules/completeness';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { audit } from '@/lib/audit/audit';

/**
 * POST /api/intake — validate + write an intake, its outlet master, and its
 * candidate sites, then create a queued pipeline_run. Enforces the 80%
 * completeness gate. Outlet/site geom is computed by DB trigger from lat/lon.
 *
 * Sequential writes (no deep nested creates) — safe under the Neon HTTP adapter.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return errors.unauthorized();

  // Demo/mock accounts (mock-admin, etc.) have non-UUID ids and no app_user row, so their
  // id can't be a foreign key. Writing an intake as one throws a Postgres UUID error. Real
  // registered accounts have UUID ids and work normally — steer demo users to register.
  if (isMockUser(session)) {
    return fail(
      {
        code: 'demo_account_readonly',
        message:
          'You are signed in with a demo account, which is read-only and cannot save intakes. Register a real account (or log in with one) to run and save analyses.',
      },
      403,
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = intakeSubmitSchema.safeParse(body);
  if (!parsed.success) return failValidation(parsed.error);
  const input = parsed.data;

  // Resolve the franchisor: either an existing one (access-checked), or a lightweight
  // one created on the fly for an independent operator, anchored to a comparable brand
  // so the concept discriminator / scoring adapts to their business.
  let franchisorId: string;
  let conceptAnchor: string | null = null;
  let brandLabel = 'Analysis';
  if (input.independent) {
    const created = await prisma.franchisor.create({
      data: {
        brandName: input.independent.name,
        sector: sectorForVertical(input.vertical),
        subCategory: input.independent.comparableBrand, // the concept anchor
        positioning: `Independent · benchmarked against ${input.independent.comparableBrand}`,
        // Link the independent operator to their own new franchisor so scoping holds.
        ...(session.franchisorId ? {} : {}),
      },
    });
    franchisorId = created.id;
    conceptAnchor = input.independent.comparableBrand;
    brandLabel = input.independent.name;
  } else {
    if (!input.franchisorId) return fail({ code: 'bad_request', message: 'Missing franchisorId.' }, 400);
    const franchisor = await prisma.franchisor.findUnique({
      where: { id: input.franchisorId },
      select: { id: true, brandName: true, _count: { select: { users: true } } },
    });
    if (!franchisor) return errors.notFound('Franchisor');
    // A user can run an intake for a brand they own OR any SHARED catalog brand (one with
    // no owning user). Private client franchisors (owned by a user) stay access-scoped so
    // one franchisor can't read another's private data.
    const isSharedCatalog = franchisor._count.users === 0;
    if (!isSharedCatalog && !canAccessFranchisor(session, input.franchisorId)) return errors.forbidden();
    franchisorId = input.franchisorId;
    brandLabel = franchisor.brandName;
  }

  // 80% must-have completeness gate.
  const completeness = computeCompleteness(input.sections);
  if (completeness.pct < 80) {
    return fail(
      {
        code: 'completeness_gate',
        message: `Intake is ${completeness.pct}% complete; 80% of must-have sections are required to submit.`,
        details: completeness.missing.map((s) => ({ path: `sections.${s}`, message: 'Required section missing.' })),
      },
      422,
    );
  }

  // 1) intake_submission. For an independent, fold the comparable brand into sectionA
  // so the orchestrator's concept text picks it up (it reads sectionA.brand/concept).
  const sectionData = mapSections(input.sections);
  if (conceptAnchor) {
    const a = (sectionData.sectionA as Record<string, unknown> | undefined) ?? {};
    sectionData.sectionA = { ...a, brand: conceptAnchor, concept: (a as { concept?: string }).concept ?? conceptAnchor };
  }
  // Versioning: if this is an edit-and-rerun (parentIntakeId set), resolve the lineage's
  // ROOT intake and the next version number. The root is v1; edits are v2, v3, …
  let parentIntakeId: string | null = null;
  let version = 1;
  if (input.parentIntakeId) {
    const parent = await prisma.intakeSubmission.findUnique({
      where: { id: input.parentIntakeId },
      select: { id: true, parentIntakeId: true },
    });
    if (parent) {
      const rootId = parent.parentIntakeId ?? parent.id; // normalise to the lineage root
      parentIntakeId = rootId;
      const count = await prisma.intakeSubmission.count({
        where: { OR: [{ id: rootId }, { parentIntakeId: rootId }] },
      });
      version = count + 1;
    }
  }

  const intake = await prisma.intakeSubmission.create({
    data: {
      franchisorId,
      vertical: input.vertical,
      completenessPct: new Prisma.Decimal(completeness.pct),
      status: 'submitted',
      submittedAt: new Date(),
      createdByUserId: session.id,
      parentIntakeId,
      version,
      ...sectionData,
    },
  });

  // 2) outlet rows — geom via trigger. NOTE: sequential single creates, NOT createMany.
  // Under the Neon HTTP adapter (PrismaNeonHTTP), Prisma runs createMany inside a
  // transaction, and the Neon HTTP driver throws "Transactions are not supported in
  // HTTP mode". Single create() calls are one-shot statements and work fine, so we
  // insert outlets one at a time (small N — a franchisor's existing branch list).
  for (const o of input.outlets) {
    await prisma.outlet.create({
      data: {
        franchisorId,
        outletName: o.outletName,
        format: o.format,
        lat: o.lat,
        lon: o.lon,
        monthlySalesPhp: o.monthlySalesPhp != null ? new Prisma.Decimal(o.monthlySalesPhp) : null,
        performanceTag: o.performanceTag,
        truthLayer: 'assumed' as const,
      },
    });
  }

  // Auto-generate a human-friendly run name so the owner can tell reports apart, e.g.
  // "BrewLab Tea — 2 sites — Aug 3, 3:24 PM". Renameable later from the dashboard.
  const siteN = input.candidateSites.length;
  const stamp = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date());
  const runName = `${brandLabel} — ${siteN} site${siteN === 1 ? '' : 's'} — ${stamp}${version > 1 ? ` (v${version})` : ''}`;

  // 3) pipeline_run
  const run = await prisma.pipelineRun.create({
    data: {
      intakeSubmissionId: intake.id,
      franchisorId,
      vertical: input.vertical,
      status: 'queued',
      name: runName,
      createdByUserId: session.id,
    },
  });

  // 4) candidate sites — geom via trigger
  for (const c of input.candidateSites) {
    await prisma.candidateSite.create({
      data: {
        pipelineRunId: run.id,
        label: c.label,
        address: c.address,
        barangay: c.barangay,
        city: c.city,
        lat: c.lat,
        lon: c.lon,
        siteType: c.siteType,
      },
    });
  }

  await audit({
    actorId: session.id,
    action: 'submit_intake',
    entity: 'intake_submission',
    entityId: intake.id,
    meta: { runId: run.id, outlets: input.outlets.length, sites: input.candidateSites.length },
  });

  return ok({ intakeId: intake.id, runId: run.id, completenessPct: completeness.pct }, { status: 201 });
}

/** Map a flat sections record onto the section_a…k columns. */
function mapSections(sections: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of REQUIRED_SECTIONS) {
    const v = sections[key];
    if (v !== undefined) out[`section${key.toUpperCase()}`] = v;
  }
  // Category-conditional intake fields (QA v6) ride in the spare H/I/J JSONB slots,
  // wrapped so downstream modules can read them by name: land parcel → H,
  // mall tier → I, per-unit capacity → J. Each stores the raw picked/typed string.
  const land = str(sections.land);
  const mall = str(sections.mall);
  const units = str(sections.units);
  if (land) out.sectionH = { landParcel: land };
  if (mall) out.sectionI = { mallTier: mall };
  if (units) out.sectionJ = { capacityUnits: units };
  return out;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** Map a vertical to the Sector enum for an on-the-fly independent franchisor. */
function sectorForVertical(vertical: string): 'FnB' | 'Retail' | 'Services' {
  if (vertical.startsWith('fnb_')) return 'FnB';
  if (vertical.startsWith('retail_') || vertical === 'convenience' || vertical === 'pharmacy') return 'Retail';
  return 'Services';
}
