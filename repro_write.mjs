import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { neon, types } from '@neondatabase/serverless';
import { PrismaNeonHTTP } from '@prisma/adapter-neon';

const toIso = (v) => {
  if (v == null) return v;
  if (!String(v).includes(' ') && !String(v).includes('T')) return v;
  let s = String(v).replace(' ', 'T');
  s = s.replace(/([+-])00(:00)?$/, 'Z');
  s = s.replace(/T.*[+-]\d{2}$/, (m) => `${m}:00`);
  return s;
};
for (const oid of [1082,1083,1114,1184,1266]) types.setTypeParser(oid, toIso);

const sql = neon(process.env.DATABASE_URL);
const adapter = new PrismaNeonHTTP(sql);
const prisma = new PrismaClient({ adapter, log: ['warn','error'] });

async function tryWrite(label, fn) {
  try { const r = await fn(); console.log(`[OK] ${label}:`, JSON.stringify(r).slice(0,120)); return r; }
  catch (e) { console.log(`[FAIL] ${label}: ${e.constructor.name}: ${e.message.split('\n')[0]}`); return null; }
}

// 1) plain table, no geom trigger
await tryWrite('auditLog.create', () => prisma.auditLog.create({
  data: { actorId: null, action: 'repro_test', entity: 'repro', entityId: null, meta: { t: 1 } }
}));

// 2) franchisor create (plain)
const fr = await tryWrite('franchisor.create', () => prisma.franchisor.create({
  data: { brandName: 'ReproTest '+Math.floor(Date.now()/1000), sector: 'FnB' }
}));

// 3) intake create (jsonb + timestamptz + decimal)
let intake = null;
if (fr) intake = await tryWrite('intakeSubmission.create', () => prisma.intakeSubmission.create({
  data: { franchisorId: fr.id, vertical: 'fnb_qsr', status: 'submitted', submittedAt: new Date(),
    sectionA: { brand: 'Repro', concept: 'x' } }
}));

// 4) outlet.createMany (bulk, geom trigger)
if (fr) await tryWrite('outlet.createMany', () => prisma.outlet.createMany({
  data: [{ franchisorId: fr.id, outletName: 'ReproOutlet', format: 'inline', lat: 14.55, lon: 121.02, truthLayer: 'assumed' }]
}));

// 5) pipelineRun.create
let run = null;
if (intake) run = await tryWrite('pipelineRun.create', () => prisma.pipelineRun.create({
  data: { intakeSubmissionId: intake.id, franchisorId: fr.id, vertical: 'fnb_qsr', status: 'queued' }
}));

// 6) candidateSite.create (geom trigger)
if (run) await tryWrite('candidateSite.create', () => prisma.candidateSite.create({
  data: { pipelineRunId: run.id, label: 'ReproSite', address: 'x', city: 'Makati', lat: 14.55, lon: 121.02, siteType: 'inline' }
}));

// cleanup repro rows
try { if (fr) await prisma.franchisor.delete({ where: { id: fr.id } }); console.log('[cleanup] repro franchisor removed (cascade)'); } catch(e){ console.log('[cleanup] skip:', e.message.split(String.fromCharCode(10))[0]); }
process.exit(0);
