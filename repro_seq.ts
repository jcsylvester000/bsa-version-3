/** Mirror the FULL /api/intake query sequence in one request, + inspect neon's default jsonb parser. */
import 'dotenv/config';
import { neon, types } from '@neondatabase/serverless';

// Inspect what neon's DEFAULT jsonb(3802)/json(114) parser returns for a raw pg text value.
console.log('--- neon default parsers (BEFORE any override) ---');
const dj = types.getTypeParser(3802);
console.log('jsonb parser typeof:', typeof dj, '| parse({"a":1}) =>', JSON.stringify(dj('{"a":1}')), '| typeof result:', typeof dj('{"a":1}'));

import { prisma } from './lib/db/prisma';
import { Prisma } from '@prisma/client';

async function main() {
  const fr: any = await prisma.franchisor.create({ data: { brandName: 'SeqRepro '+Math.floor(Date.now()/1000), sector: 'FnB' } });
  // mimic the route's pre-write reads
  await prisma.franchisor.findUnique({ where: { id: fr.id }, select: { id: true, brandName: true, _count: { select: { users: true } } } });
  await prisma.intakeSubmission.count({ where: { franchisorId: fr.id } });
  try {
    const intake: any = await prisma.intakeSubmission.create({
      data: { franchisorId: fr.id, vertical: 'fnb_qsr', status: 'submitted', submittedAt: new Date(),
        completenessPct: new Prisma.Decimal(100), version: 1, parentIntakeId: null,
        sectionA: { brand: 'Jollibee', concept: 'x' }, sectionG: { outletCount: 3 }, sectionK: { auditConsent: true },
        sectionH: { landParcel: 'x' }, sectionI: { mallTier: 'x' }, sectionJ: { capacityUnits: 'x' } },
    });
    console.log('SEQUENCE intake.create -> OK, sectionA =', JSON.stringify(intake.sectionA), 'typeof', typeof intake.sectionA);
  } catch (e: any) {
    console.log('SEQUENCE intake.create -> FAIL:', String(e?.message).split('\n')[0], '| code', e?.code);
  } finally {
    try { await prisma.franchisor.delete({ where: { id: fr.id } }); } catch {}
  }
  process.exit(0);
}
main();
