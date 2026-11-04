/**
 * Brief alignment T-7 — record counts for investor material, WITHOUT test / demo data.
 *
 *   npm run db:counts
 *
 * Read-only. Prints a Markdown table (paste into the brief) of the reference data by source and Truth
 * Layer, plus client activity with test/demo accounts (lib/data/testAccounts.ts) left out.
 */
import 'dotenv/config';
import { prisma } from '@/lib/db/prisma';
import { isTestAccountEmail } from '@/lib/data/testAccounts';

type Row = Record<string, unknown>;
const q = <T extends Row>(sql: TemplateStringsArray, ...v: unknown[]) => prisma.$queryRaw<T[]>(sql, ...v);
const n = (v: unknown) => Number(v ?? 0).toLocaleString('en-US');

async function main() {
  const users = await prisma.appUser.findMany({ select: { id: true, email: true } });
  const testIds = users.filter((u) => isTestAccountEmail(u.email)).map((u) => u.id);
  console.log(`Accounts: ${users.length} (${testIds.length} test/demo excluded)\n`);

  const lines: string[] = ['| Data | Breakdown | Records |', '|---|---|---|'];
  const add = (data: string, breakdown: string, count: unknown) => lines.push(`| ${data} | ${breakdown} | ${n(count)} |`);

  for (const r of await q<{ region: string | null; level: string; c: number }>`
    SELECT region, level, COUNT(*)::int AS c FROM admin_boundary GROUP BY region, level ORDER BY region, level`) {
    add('Boundaries (PSA PSGC, Verified)', `${r.region ?? '—'} · ${r.level}`, r.c);
  }
  for (const r of await q<{ t: string; y: number | null; c: number }>`
    SELECT COALESCE(population_truth, truth_layer)::text AS t, census_year AS y, COUNT(*)::int AS c
    FROM demographic_cell GROUP BY 1, 2 ORDER BY 1, 2`) {
    add('Population per barangay', `${r.t}${r.y ? ` · census ${r.y}` : ' · legacy sample'}`, r.c);
  }
  for (const r of await q<{ source: string; region: string | null; c: number }>`
    SELECT source::text AS source, region, COUNT(*)::int AS c FROM poi GROUP BY 1, 2 ORDER BY 3 DESC`) {
    add('Places', `${r.source} · ${r.region || 'no region'}`, r.c);
  }
  for (const r of await q<{ region: string | null; t: string; c: number }>`
    SELECT region, truth_layer::text AS t, COUNT(*)::int AS c FROM zonal_value GROUP BY 1, 2 ORDER BY 1, 2`) {
    add('BIR zonal values', `${r.region ?? '—'} · ${r.t}`, r.c);
  }
  for (const r of await q<{ t: string; c: number; d0: string | null; d1: string | null }>`
    SELECT truth_layer::text AS t, COUNT(*)::int AS c, MIN(observed_date)::text AS d0, MAX(observed_date)::text AS d1
    FROM lease_comp GROUP BY 1`) {
    add('Lease comparables', `${r.t} · ${r.d0 ?? '?'} to ${r.d1 ?? '?'}`, r.c);
  }
  for (const r of await q<{ t: string; c: number }>`SELECT truth_layer::text AS t, COUNT(*)::int AS c FROM mall_property GROUP BY 1`) {
    add('Malls', r.t, r.c);
  }
  for (const r of await q<{ t: string; counted: boolean; c: number }>`
    SELECT truth_layer::text AS t, (aadt_ref IS NOT NULL) AS counted, COUNT(*)::int AS c FROM traffic_corridor GROUP BY 1, 2`) {
    add('Traffic corridors', `${r.t} · ${r.counted ? 'with traffic count' : 'template, no count'}`, r.c);
  }
  // Outlets: brand lists + reference network, plus typed outlets from NON-test intakes only.
  for (const r of await q<{ source: string; t: string; c: number }>`
    SELECT o.source::text AS source, COALESCE(o.location_truth, o.truth_layer)::text AS t, COUNT(*)::int AS c
    FROM outlet o LEFT JOIN intake_submission i ON i.id = o.intake_submission_id
    WHERE o.intake_submission_id IS NULL OR NOT COALESCE(i.created_by_user_id = ANY(${testIds}::uuid[]), false)
    GROUP BY 1, 2 ORDER BY 1, 2`) {
    add('Brand outlets', `${r.source} · location ${r.t}`, r.c);
  }
  const runs = await q<{ c: number; sites: number }>`
    SELECT COUNT(DISTINCT r.id)::int AS c, COUNT(s.id)::int AS sites
    FROM pipeline_run r LEFT JOIN candidate_site s ON s.pipeline_run_id = r.id
    WHERE NOT COALESCE(r.created_by_user_id = ANY(${testIds}::uuid[]), false)`;
  add('Client analyses (excl. test/demo)', `${n(runs[0]?.sites)} sites`, runs[0]?.c);

  console.log(lines.join('\n'));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .then(async () => { await prisma.$disconnect(); });
