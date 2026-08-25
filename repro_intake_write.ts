/** Repro v3: mirror the LIVE /api/intake write path EXACTLY (version, sectionData spread, all creates). */
import 'dotenv/config';
import { prisma } from './lib/db/prisma';
import { Prisma } from '@prisma/client';

async function step(label: string, fn: () => Promise<any>) {
  try { const r = await fn(); console.log(`[OK]   ${label}`); return r; }
  catch (e: any) { console.log(`[FAIL] ${label}\n       ${e?.constructor?.name}: ${String(e?.message).split('\n').slice(0,3).join(' | ')}${e?.code ? '  (code '+e.code+')' : ''}`); return null; }
}

async function main() {
  const fr: any = await prisma.franchisor.create({ data: { brandName: 'ReproV3 ' + Math.floor(Date.now()/1000), sector: 'FnB' } });

  // Mirror route: intake create WITH version, parentIntakeId=null, and sectionData spread (A + H/I/J jsonb)
  const sectionData: Record<string, unknown> = {
    sectionA: { brand: 'Jollibee', concept: 'value burger & chicken QSR' },
    sectionG: { outletCount: 3 },
    sectionK: { auditConsent: true },
    sectionH: { landParcel: 'x' }, sectionI: { mallTier: 'x' }, sectionJ: { capacityUnits: 'x' },
  };
  const intake: any = await step('intakeSubmission.create (version + sectionData spread)', () =>
    prisma.intakeSubmission.create({
      data: {
        franchisorId: fr.id, vertical: 'fnb_qsr',
        completenessPct: new Prisma.Decimal(100), status: 'submitted', submittedAt: new Date(),
        createdByUserId: null, parentIntakeId: null, version: 1, ...sectionData,
      },
    }));

  if (intake) {
    for (const o of [{n:'A'},{n:'B'},{n:'C'}]) {
      await step('outlet.create '+o.n, () => prisma.outlet.create({ data: { franchisorId: fr.id, outletName: 'Repro '+o.n, format: 'inline', lat: 14.55, lon: 121.02, truthLayer: 'assumed' as const } }));
    }
    const run: any = await step('pipelineRun.create (with name)', () => prisma.pipelineRun.create({
      data: { intakeSubmissionId: intake.id, franchisorId: fr.id, vertical: 'fnb_qsr', status: 'queued', name: 'Jollibee — 2 sites — repro', createdByUserId: null },
    }));
    if (run) for (const c of [{l:'S1'},{l:'S2'}]) {
      await step('candidateSite.create '+c.l, () => prisma.candidateSite.create({ data: { pipelineRunId: run.id, label: c.l, address: 'x', barangay: null, city: 'Makati', lat: 14.55, lon: 121.02, siteType: 'inline' } }));
    }
    // audit
    await step('auditLog.create', () => prisma.auditLog.create({ data: { actorId: null, action: 'submit_intake', entity: 'intake_submission', entityId: intake.id, meta: { x: 1 } } }));
  }

  try { await prisma.franchisor.delete({ where: { id: fr.id } }); console.log('[cleanup] removed'); } catch(e:any){ console.log('[cleanup] skip:', String(e?.message).split('\n')[0]); }
  process.exit(0);
}
main();
