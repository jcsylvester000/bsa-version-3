/** Isolate the JSONB round-trip through the Neon HTTP adapter, WITH vs WITHOUT a jsonb text parser. */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { neon, types } from '@neondatabase/serverless';
import { PrismaNeonHTTP } from '@prisma/adapter-neon';

const toIso = (v: any) => {
  if (v == null) return v;
  const s0 = String(v);
  if (!s0.includes(' ') && !s0.includes('T')) return v;
  let s = s0.replace(' ', 'T');
  s = s.replace(/([+-])00(:00)?$/, 'Z');
  s = s.replace(/T.*[+-]\d{2}$/, (m) => `${m}:00`);
  return s;
};

function makeClient(withJsonFix: boolean) {
  for (const oid of [1082,1083,1114,1184,1266]) types.setTypeParser(oid, toIso);
  if (withJsonFix) {
    // Hand Prisma the RAW json text; Prisma parses it itself (driver-adapter contract).
    types.setTypeParser(114, (v: string) => v);   // json
    types.setTypeParser(3802, (v: string) => v);  // jsonb
  } else {
    // restore neon defaults (parse to object) — the suspected-broken behavior
    types.setTypeParser(114, (v: string) => JSON.parse(v));
    types.setTypeParser(3802, (v: string) => JSON.parse(v));
  }
  const sql = neon(process.env.DATABASE_URL as string);
  return new PrismaClient({ adapter: new PrismaNeonHTTP(sql), log: ['error'] });
}

async function run(label: string, withJsonFix: boolean) {
  const prisma = makeClient(withJsonFix);
  const fr: any = await prisma.franchisor.create({ data: { brandName: 'JsonRepro '+label+' '+Math.floor(Date.now()/1000), sector: 'FnB' } });
  try {
    const intake: any = await prisma.intakeSubmission.create({
      data: { franchisorId: fr.id, vertical: 'fnb_qsr', status: 'submitted', submittedAt: new Date(),
        completenessPct: new Prisma.Decimal(100),
        sectionA: { brand: 'Jollibee', concept: 'x' }, sectionG: { outletCount: 3 }, sectionK: { auditConsent: true },
        sectionH: { landParcel: 'x' }, sectionI: { mallTier: 'x' }, sectionJ: { capacityUnits: 'x' } },
    });
    console.log(`[${label}] intakeSubmission.create -> OK (sectionA back = ${JSON.stringify(intake.sectionA)})`);
  } catch (e: any) {
    console.log(`[${label}] intakeSubmission.create -> FAIL: ${String(e?.message).split('\n')[0]}`);
  } finally {
    try { await prisma.franchisor.delete({ where: { id: fr.id } }); } catch {}
    await prisma.$disconnect();
  }
}

async function main() {
  await run('WITHOUT-json-fix (neon default: parse to object)', false);
  await run('WITH-json-fix (raw text -> Prisma parses)', true);
  process.exit(0);
}
main();
