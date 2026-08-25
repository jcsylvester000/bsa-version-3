/** Verify the JSON parser fix: write + read JSON columns through the app's real adapter client. */
import 'dotenv/config';
import { prisma } from './lib/db/prisma';   // now includes the toRawJson parsers
import { Prisma } from '@prisma/client';

async function main() {
  // WRITE path: intake with all section JSON columns
  const fr: any = await prisma.franchisor.create({ data: { brandName: 'JsonFix '+Math.floor(Date.now()/1000), sector: 'FnB', requirements: { a: 1, nested: { b: [1,2,3] } } } });
  let ok = true;
  try {
    const intake: any = await prisma.intakeSubmission.create({
      data: { franchisorId: fr.id, vertical: 'fnb_qsr', status: 'submitted', submittedAt: new Date(),
        completenessPct: new Prisma.Decimal(100),
        sectionA: { brand: 'Jollibee', concept: 'x' }, sectionK: { auditConsent: true } },
    });
    console.log('WRITE intake.create -> OK  sectionA =', JSON.stringify(intake.sectionA), '(typeof', typeof intake.sectionA + ')');
    if (typeof intake.sectionA !== 'object' || intake.sectionA?.brand !== 'Jollibee') { ok = false; console.log('  !! sectionA not a usable object'); }
  } catch (e: any) { ok = false; console.log('WRITE intake.create -> FAIL:', String(e?.message).split('\n')[0]); }

  // READ path: read the JSON `requirements` column back (mirrors screening/brands reads)
  try {
    const back: any = await prisma.franchisor.findUnique({ where: { id: fr.id }, select: { requirements: true } });
    console.log('READ franchisor.requirements -> OK =', JSON.stringify(back?.requirements), '(typeof', typeof back?.requirements + ')');
    if (back?.requirements?.nested?.b?.[2] !== 3) { ok = false; console.log('  !! requirements not a usable nested object'); }
  } catch (e: any) { ok = false; console.log('READ franchisor.requirements -> FAIL:', String(e?.message).split('\n')[0]); }

  // READ a real existing franchisor with requirements (the actual screening data path)
  try {
    const real: any = await prisma.franchisor.findFirst({ where: { requirements: { not: Prisma.DbNull } }, select: { brandName: true, requirements: true } });
    console.log('READ existing brand w/ requirements -> OK:', real?.brandName, '| requirements typeof', typeof real?.requirements);
  } catch (e: any) { ok = false; console.log('READ existing brand -> FAIL:', String(e?.message).split('\n')[0]); }

  try { await prisma.franchisor.delete({ where: { id: fr.id } }); } catch {}
  console.log(ok ? '\nRESULT: PASS — JSON write + read both work, values usable as objects' : '\nRESULT: FAIL');
  process.exit(0);
}
main();
