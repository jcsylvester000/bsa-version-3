import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
try {
  const count = await p.competitorSet.count();
  console.log('competitor_set rows:', count);
  const byConcept = await p.competitorSet.groupBy({ by: ['conceptKey'], _count: true });
  console.log('concepts:', byConcept.map(c => `${c.conceptKey}:${c._count}`).join(', '));
  const sample = await p.competitorSet.findFirst({ where: { conceptKey: 'qsr' }, select: { anchorBrand: true, competitors: true, truthLayer: true } });
  console.log('sample qsr:', JSON.stringify(sample));
} catch (e) { console.log('ERROR:', e.message); } finally { await p.$disconnect(); }
