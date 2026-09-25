import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { getSession } from '@/lib/auth/session';
import { canSeeFranchisor } from '@/lib/auth/auth';
import { regionForSite } from '@/lib/geo/regions';
import { resolveAdminBoundary } from '@/lib/geo/adminBoundary';
import { isMockUser } from '@/lib/auth/mockUsers';
import { intakeSubmitSchema } from '@/lib/validation/schemas';
import { computeCompleteness, REQUIRED_SECTIONS } from '@/lib/modules/completeness';
import { ok, fail, failValidation, errors } from '@/lib/api/respond';
import { manilaShortStamp } from '@/lib/util/manilaTime';
import { audit } from '@/lib/audit/audit';
import { captureException, errorRef } from '@/lib/monitoring/report';

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

  // F-06: run EVERY validation/authorization/gate that can reject the request BEFORE writing
  // anything. For an independent operator the franchisor row is NOT created here — it's created
  // inside the write block below (and cleaned up if a later write fails), so a rejected submit
  // never leaves an orphan brand in Franchise Screening.
  let conceptAnchor: string | null = null;
  let brandLabel = 'Analysis';
  // For an existing brand we resolve + access-check now (a read). For an independent, we hold the
  // details and create the row only in the write phase.
  let existingFranchisorId: string | null = null;
  if (input.independent) {
    conceptAnchor = input.independent.comparableBrand;
    brandLabel = input.independent.name;
  } else {
    if (!input.franchisorId) return fail({ code: 'bad_request', message: 'Missing franchisorId.' }, 400);
    const franchisor = await prisma.franchisor.findUnique({
      where: { id: input.franchisorId },
      select: { id: true, brandName: true, createdByUserId: true, _count: { select: { users: true } } },
    });
    // A user can run an intake for a brand they own/created OR any SHARED catalog brand.
    // Anything else answers 404 so a private brand's existence isn't confirmed.
    if (
      !franchisor ||
      !canSeeFranchisor(session, { id: franchisor.id, createdByUserId: franchisor.createdByUserId, ownerCount: franchisor._count.users })
    ) {
      return errors.notFound('Franchisor');
    }
    existingFranchisorId = input.franchisorId;
    brandLabel = franchisor.brandName;
  }

  // 80% must-have completeness gate — still BEFORE any write.
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
      select: { id: true, parentIntakeId: true, createdByUserId: true },
    });
    // Only the intake's owner (or Grid staff) may version it — no attaching to someone
    // else's lineage.
    const staff = session.role === 'admin' || session.role === 'analyst';
    if (parent && !staff && parent.createdByUserId !== session.id) return errors.notFound('Intake');
    if (parent) {
      const rootId = parent.parentIntakeId ?? parent.id; // normalise to the lineage root
      parentIntakeId = rootId;
      const count = await prisma.intakeSubmission.count({
        where: { OR: [{ id: rootId }, { parentIntakeId: rootId }] },
      });
      version = count + 1;
    }
  }

  // Track everything we write so a failure part-way can be rolled back by hand (the Neon HTTP
  // adapter has no multi-statement transaction). Deleting the run cascades to its candidate sites.
  const cleanup: { runId?: string; intakeId?: string; createdFranchisorId?: string } = {};
  try {
    // Create the independent operator's brand now, inside the write phase, so a failure leaves
    // no orphan. An existing brand was already resolved + access-checked above.
    let franchisorId: string;
    if (input.independent) {
      const createdFr = await prisma.franchisor.create({
        data: {
          brandName: input.independent.name,
          sector: sectorForVertical(input.vertical),
          subCategory: input.independent.comparableBrand, // the concept anchor
          positioning: `Independent · benchmarked against ${input.independent.comparableBrand}`,
          // Brand privacy: an independent business is private to the user who created it —
          // it must never appear in another user's brand list or be runnable by them.
          createdByUserId: session.id,
        },
      });
      franchisorId = createdFr.id;
      cleanup.createdFranchisorId = createdFr.id;
    } else {
      franchisorId = existingFranchisorId!;
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
    cleanup.intakeId = intake.id;

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
          // Owned by this intake: only this run's Territory Guard sees these outlets.
          intakeSubmissionId: intake.id,
        },
      });
    }

    // Auto-generate a human-friendly run name so the owner can tell reports apart, e.g.
    // "BrewLab Tea — 2 sites — Aug 3, 3:24 PM". Renameable later from the dashboard.
    const siteN = input.candidateSites.length;
    const stamp = manilaShortStamp(new Date());
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
    cleanup.runId = run.id;

    // 4) candidate sites — geom via trigger. Tag the region (LGU name first, else pinned
    // coordinate). When boundary polygons are loaded (R-02), also stamp the real barangay/city/
    // province/PSGC from a point-in-polygon lookup; otherwise keep the user's values + coarse region.
    for (const c of input.candidateSites) {
      const bnd = await resolveAdminBoundary(c.lat, c.lon);
      const region = bnd?.region ?? regionForSite({ city: c.city, label: c.label, lat: c.lat, lon: c.lon });
      await prisma.candidateSite.create({
        data: {
          pipelineRunId: run.id,
          label: c.label,
          address: c.address,
          barangay: c.barangay ?? bnd?.barangay ?? undefined,
          city: c.city ?? bnd?.city ?? undefined,
          lat: c.lat,
          lon: c.lon,
          siteType: c.siteType,
          region: region ?? undefined,
          province: bnd?.province ?? undefined,
          psgcCode: bnd?.psgcCode ?? undefined,
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
  } catch (err) {
    // F-24: never echo raw DB/driver messages to the browser (they leak table/column names and
    // internals). F-51: report through the monitoring seam with a short reference the user can quote.
    const ref = errorRef();
    await captureException(err, { ref, code: 'intake_write_failed', route: 'POST /api/intake' });

    // F-06: compensating rollback (no Neon HTTP transaction). Delete what we wrote, in reverse:
    // the run cascades to its candidate sites; then this intake's outlets; then the intake; then
    // the brand — but ONLY if we created it here (never a pre-existing shared catalog brand).
    // Each delete is best-effort so one failure can't mask the original error.
    try {
      if (cleanup.runId) await prisma.pipelineRun.delete({ where: { id: cleanup.runId } }).catch(() => undefined);
      if (cleanup.intakeId) {
        await prisma.outlet.deleteMany({ where: { intakeSubmissionId: cleanup.intakeId } }).catch(() => undefined);
        await prisma.intakeSubmission.delete({ where: { id: cleanup.intakeId } }).catch(() => undefined);
      }
      if (cleanup.createdFranchisorId) {
        await prisma.franchisor.delete({ where: { id: cleanup.createdFranchisorId } }).catch(() => undefined);
      }
    } catch (cleanupErr) {
      console.error(`[POST /api/intake] cleanup after ref=${ref} failed`, cleanupErr);
    }

    return errors.server(`Failed to save intake. Please try again; if it keeps failing, quote reference ${ref}.`);
  }
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
