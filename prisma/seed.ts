/**
 * Seed — a demo franchisor with a realistic Metro Manila outlet network, demo
 * users for each role, a candidate site positioned to overlap an existing branch,
 * and a small doc_chunk corpus for the AI retrieve step. Idempotent: upserts on
 * natural keys / stable ids so re-running never duplicates.
 *
 * The outlet coordinates are chosen so Territory Guard produces a meaningful result
 * out of the box: the candidate site sits ~600 m from an existing BGC branch (heavy
 * overlap → "redistributes") and far from the others.
 */
import 'dotenv/config'; // load .env so DATABASE_URL is available when run via `tsx`
import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

// Stable UUIDs so re-seeding is idempotent.
const FRANCHISOR_ID = '11111111-1111-1111-1111-111111111111';

/** Shape of one entry in franchiseRequirements.real.json. */
interface ReqEntry {
  vertical: string;
  category?: string | null;
  franchisor?: string | null;
  [k: string]: unknown;
}

/** Map a Vertical enum value to its Sector, for auto-creating a Franchisor from a
 *  requirements entry. Mirrors the same mapping used by the intake route. */
function sectorForVertical(vertical: string): 'FnB' | 'Retail' | 'Services' {
  if (vertical.startsWith('fnb_')) return 'FnB';
  if (['retail_apparel', 'retail_specialty', 'convenience', 'pharmacy'].includes(vertical)) return 'Retail';
  return 'Services';
}

async function main() {
  console.log('Seeding BSA demo data…');

  // --- franchisor ----------------------------------------------------------
  // Real Philippine milk-tea chain. Its outlets below are real Metro Manila branches.
  await prisma.franchisor.upsert({
    where: { id: FRANCHISOR_ID },
    update: {
      brandName: 'Macao Imperial Tea',
      legalName: 'Macao Imperial Tea Philippines',
      sector: 'FnB',
      subCategory: 'Milk tea / beverages',
      positioning: 'Premium milk tea with a signature cheese-tea series for young urban professionals and students.',
    },
    create: {
      id: FRANCHISOR_ID,
      brandName: 'Macao Imperial Tea',
      legalName: 'Macao Imperial Tea Philippines',
      sector: 'FnB',
      subCategory: 'Milk tea / beverages',
      positioning: 'Premium milk tea with a signature cheese-tea series for young urban professionals and students.',
    },
  });

  // --- franchise-brand catalog --------------------------------------------
  // A shared catalog of real PH franchise brands so the intake dropdown is rich out of
  // the box (no paid Google pull needed — these are franchisor RECORDS only). Idempotent
  // on brandName. Users can also add their own brand from the intake screen.
  const BRAND_CATALOG: Array<{ brandName: string; sector: 'FnB' | 'Retail' | 'Services'; subCategory: string; positioning: string }> = [
    { brandName: 'Jollibee', sector: 'FnB', subCategory: 'QSR / fast food', positioning: 'Market-leading value burger & chicken QSR' },
    { brandName: 'Chatime', sector: 'FnB', subCategory: 'Milk tea / beverages', positioning: 'Global milk-tea franchise' },
    { brandName: 'Starbucks', sector: 'FnB', subCategory: 'Coffee', positioning: 'Premium dwell-time coffee cafe' },
    { brandName: 'Mang Inasal', sector: 'FnB', subCategory: 'QSR / grilled chicken', positioning: 'Grilled chicken inasal QSR' },
    { brandName: 'Red Ribbon', sector: 'FnB', subCategory: 'Bakery / dessert', positioning: 'Cakes & pastries bakeshop' },
    { brandName: '7-Eleven', sector: 'Retail', subCategory: 'Convenience store', positioning: '24/7 convenience network' },
    { brandName: 'Mercury Drug', sector: 'Retail', subCategory: 'Pharmacy', positioning: 'Leading pharmacy chain' },
    { brandName: 'Bench', sector: 'Retail', subCategory: 'Apparel', positioning: 'Everyday apparel & specialty retail' },
    { brandName: 'Petron', sector: 'Services', subCategory: 'Fuel retail', positioning: 'Fuel-station network' },
    { brandName: 'Anytime Fitness', sector: 'Services', subCategory: 'Fitness', positioning: '24/7 membership gym' },
    // 10 NEW brands (added this round) across verticals:
    { brandName: 'Serenitea', sector: 'FnB', subCategory: 'Milk tea / beverages', positioning: 'Pioneer premium milk tea chain' },
    { brandName: 'CoCo Fresh Tea & Juice', sector: 'FnB', subCategory: 'Milk tea / beverages', positioning: 'Global bubble-tea franchise' },
    { brandName: 'Bonchon', sector: 'FnB', subCategory: 'QSR / Korean fried chicken', positioning: 'Korean fried chicken QSR' },
    { brandName: 'Angel’s Pizza', sector: 'FnB', subCategory: 'QSR / pizza', positioning: 'Value overloaded-pizza delivery' },
    { brandName: 'Andok’s', sector: 'FnB', subCategory: 'QSR / grilled chicken', positioning: 'Litson manok & grilled QSR' },
    { brandName: 'The Generics Pharmacy', sector: 'Retail', subCategory: 'Pharmacy', positioning: 'Low-cost generics pharmacy network' },
    { brandName: 'Rose Pharmacy', sector: 'Retail', subCategory: 'Pharmacy', positioning: 'Regional pharmacy chain' },
    { brandName: 'FamilyMart', sector: 'Retail', subCategory: 'Convenience store', positioning: 'Japanese convenience-store format' },
    { brandName: 'Phoenix Petroleum', sector: 'Services', subCategory: 'Fuel retail', positioning: 'Independent fuel-station network' },
    { brandName: 'Fitness First', sector: 'Services', subCategory: 'Fitness', positioning: 'Premium full-service gym' },
  ];
  for (const b of BRAND_CATALOG) {
    const exists = await prisma.franchisor.findFirst({ where: { brandName: b.brandName } });
    if (!exists) await prisma.franchisor.create({ data: b });
  }
  console.log(`  franchise-brand catalog: ${BRAND_CATALOG.length} brands ensured`);

  // --- franchise requirements templates -----------------------------------
  // Attach imported franchise requirements (fee/investment/space/ROI/staffing/support,
  // each Truth-Layered) to the matching brand so the intake can auto-prefill from them.
  // Every brand in the requirements file is ENSURED as a Franchisor row — a brand not in
  // the hand-written BRAND_CATALOG above is auto-created from its requirements entry
  // (sector derived from vertical), so the full 100-brand intelligence set is queryable
  // and prefillable without maintaining a parallel catalog list.
  try {
    const reqPath = path.join(process.cwd(), 'prisma', 'data', 'franchiseRequirements.real.json');
    const reqs = JSON.parse(readFileSync(reqPath, 'utf8')) as Record<string, ReqEntry>;
    let attached = 0;
    let created = 0;
    for (const [brandName, requirements] of Object.entries(reqs)) {
      let fr = await prisma.franchisor.findFirst({ where: { brandName } });
      if (!fr) {
        fr = await prisma.franchisor.create({
          data: {
            brandName,
            sector: sectorForVertical(requirements.vertical),
            subCategory: requirements.category ?? null,
            positioning: requirements.franchisor ? `Franchise concept · ${requirements.franchisor}` : null,
          },
        });
        created++;
      }
      await prisma.franchisor.update({ where: { id: fr.id }, data: { requirements: requirements as unknown as Prisma.InputJsonValue } });
      attached++;
    }
    console.log(`  franchise requirements: ${attached} templates attached (${created} brands auto-created from the intelligence set)`);
  } catch (e) {
    console.log('  franchise requirements: skipped (data file not found)', e instanceof Error ? e.message : '');
  }

  // --- users (one per role) -----------------------------------------------
  const pw = await bcrypt.hash('bsa-demo-1234', 12);
  const users: Array<{ email: string; role: 'admin' | 'analyst' | 'broker' | 'franchisor'; franchisorId: string | null }> = [
    { email: 'admin@grid.test', role: 'admin', franchisorId: null },
    { email: 'analyst@grid.test', role: 'analyst', franchisorId: null },
    { email: 'broker@grid.test', role: 'broker', franchisorId: FRANCHISOR_ID },
    { email: 'owner@macaoimperial.test', role: 'franchisor', franchisorId: FRANCHISOR_ID },
  ];
  for (const u of users) {
    await prisma.appUser.upsert({
      where: { email: u.email },
      update: { role: u.role, franchisorId: u.franchisorId },
      create: { email: u.email, passwordHash: pw, role: u.role, franchisorId: u.franchisorId },
    });
  }

  // --- outlet network (existing branches) ----------------------------------
  // REAL Macao Imperial Tea Metro Manila branches (names + coordinates are real).
  // Sales are NOT public → Assumed placeholders (truthLayer 'assumed' below), used
  // only so the demo cannibalization estimate is non-zero. Never presented as Verified.
  const outlets = [
    { name: 'Macao Imperial Tea — One Ayala', format: 'inline', lat: 14.5505, lon: 121.0270, sales: 720_000, tag: 'hero' as const },
    { name: 'Macao Imperial Tea — Greenhills Mall', format: 'mall', lat: 14.6008, lon: 121.0504, sales: 540_000, tag: 'above' as const },
    { name: 'Macao Imperial Tea — SM Megamall', format: 'mall', lat: 14.5847, lon: 121.0566, sales: 610_000, tag: 'above' as const },
    { name: 'Macao Imperial Tea — SM MOA', format: 'mall', lat: 14.5355, lon: 120.9820, sales: 650_000, tag: 'hero' as const },
    { name: 'Macao Imperial Tea — E. Rodriguez', format: 'inline', lat: 14.6207, lon: 121.0203, sales: 430_000, tag: 'avg' as const },
    { name: 'Macao Imperial Tea — Banawe', format: 'inline', lat: 14.6360, lon: 121.0016, sales: 380_000, tag: 'below' as const },
  ];
  // Clear then re-insert this franchisor's outlets (idempotent for a demo brand).
  await prisma.outlet.deleteMany({ where: { franchisorId: FRANCHISOR_ID } });
  for (const o of outlets) {
    await prisma.outlet.create({
      data: {
        franchisorId: FRANCHISOR_ID,
        outletName: o.name,
        format: o.format,
        status: 'open',
        lat: o.lat,
        lon: o.lon,
        monthlySalesPhp: new Prisma.Decimal(o.sales),
        performanceTag: o.tag,
        // sales/perf are Assumed until the franchisor confirms them.
        truthLayer: 'assumed',
      },
    });
  }

  // --- intake + run + candidate site --------------------------------------
  // Idempotent: clear this franchisor's prior demo intakes first. Runs cascade
  // from intakes, and candidate sites cascade from runs, so this removes stale
  // demo runs/candidates left by earlier seeds (no accumulation on re-seed).
  await prisma.intakeSubmission.deleteMany({ where: { franchisorId: FRANCHISOR_ID } });

  // A minimal validated intake so a demo run can execute end to end.
  const intake = await prisma.intakeSubmission.create({
    data: {
      franchisorId: FRANCHISOR_ID,
      vertical: 'fnb_cafe',
      completenessPct: new Prisma.Decimal(100),
      status: 'submitted',
      submittedAt: new Date('2026-08-01T00:00:00Z'),
      sectionA: { brand: 'Macao Imperial Tea', concept: 'milk tea' },
      sectionG: { outletCount: outlets.length, source: 'seed' },
      sectionK: { auditConsent: true },
    },
  });

  const run = await prisma.pipelineRun.create({
    data: {
      intakeSubmissionId: intake.id,
      franchisorId: FRANCHISOR_ID,
      vertical: 'fnb_cafe',
      status: 'ready',
      exclusivityRadiusM: 1500,
    },
  });

  // Candidate on Ayala Ave, ~250 m from the real One Ayala branch → strong overlap
  // (≈75%) so Territory Guard flags redistribution against a real sister branch.
  await prisma.candidateSite.create({
    data: {
      pipelineRunId: run.id,
      label: 'Proposed — Makati Ayala Ave',
      address: 'Ayala Avenue, Makati',
      barangay: 'San Lorenzo',
      city: 'Makati',
      lat: 14.5480,
      lon: 121.0250,
      siteType: 'inline',
    },
  });

  // A second candidate far from every branch → little/no overlap.
  await prisma.candidateSite.create({
    data: {
      pipelineRunId: run.id,
      label: 'Proposed — Festival Supermall Alabang',
      address: 'Festival Supermall, Alabang, Muntinlupa',
      barangay: 'Alabang',
      city: 'Muntinlupa',
      lat: 14.4155,
      lon: 121.0431,
      siteType: 'mall',
    },
  });

  // --- doc_chunk corpus (grounds the AI retrieve step) ---------------------
  // Shared real methodology corpus (per-module methodology + Truth-Layer guardrails).
  const { seedMethodologyChunks } = await import('./methodologyChunks');
  const chunkCount = await seedMethodologyChunks();

  // --- lease_comp corridor comps (Lease Benchmark) -------------------------
  // Real inline retail bands (published 2026 ranges). The demo candidate is on
  // Makati Ayala Ave (Makati CBD corridor), so Makati comps drive its Lease
  // Benchmark; BGC comps are included too for the other corridor. Verified comps
  // come from the published band; a couple of Assumed estimates carry their basis.
  // (`db:populate` loads the fuller lease.real.json across all corridors.)
  // Idempotent: clear these corridor/format groups then insert.
  const seedComps: Record<string, Array<{ base: number; esc: number; cusa: number; term: number; fitout: number; date: string; truth: 'verified' | 'assumed'; source: string }>> = {
    'Makati CBD': [
      { base: 1800, esc: 5, cusa: 280, term: 5, fitout: 2, date: '2026-01-20', truth: 'verified', source: 'Published Makati CBD band (low)' },
      { base: 2000, esc: 5, cusa: 300, term: 5, fitout: 2, date: '2026-02-01', truth: 'verified', source: 'Published Makati CBD band' },
      { base: 2200, esc: 6, cusa: 310, term: 6, fitout: 2, date: '2026-02-15', truth: 'verified', source: 'Published Makati CBD band' },
      { base: 2400, esc: 6, cusa: 320, term: 6, fitout: 2, date: '2026-03-01', truth: 'verified', source: 'Published Makati CBD band' },
      { base: 2600, esc: 6, cusa: 340, term: 7, fitout: 3, date: '2026-03-15', truth: 'verified', source: 'Published Makati CBD band (mid)' },
      { base: 2800, esc: 6, cusa: 350, term: 7, fitout: 3, date: '2026-04-01', truth: 'assumed', source: 'Broker estimate' },
      { base: 3000, esc: 7, cusa: 360, term: 7, fitout: 3, date: '2026-04-15', truth: 'verified', source: 'Published Makati CBD band (high)' },
    ],
    BGC: [
      { base: 2200, esc: 5, cusa: 320, term: 5, fitout: 2, date: '2026-01-15', truth: 'verified', source: 'Published BGC band (low)' },
      { base: 2500, esc: 5, cusa: 340, term: 5, fitout: 2, date: '2026-02-01', truth: 'verified', source: 'Published BGC band' },
      { base: 2800, esc: 6, cusa: 360, term: 7, fitout: 2, date: '2026-02-10', truth: 'verified', source: 'Published BGC band' },
      { base: 3000, esc: 6, cusa: 380, term: 7, fitout: 3, date: '2026-03-05', truth: 'verified', source: 'Published BGC band' },
      { base: 3400, esc: 6, cusa: 400, term: 7, fitout: 3, date: '2026-03-20', truth: 'verified', source: 'Published BGC band' },
      { base: 4000, esc: 7, cusa: 440, term: 10, fitout: 3, date: '2026-05-02', truth: 'verified', source: 'Published BGC band (high)' },
      { base: 4200, esc: 7, cusa: 450, term: 10, fitout: 4, date: '2026-05-20', truth: 'assumed', source: 'Prime high-street estimate' },
    ],
  };
  let compCount = 0;
  for (const [corridor, rows] of Object.entries(seedComps)) {
    await prisma.leaseComp.deleteMany({ where: { corridor, format: 'inline' } });
    for (const c of rows) {
      await prisma.leaseComp.create({
        data: {
          format: 'inline',
          corridor,
          baseRentPhpSqm: new Prisma.Decimal(c.base),
          escalationPct: new Prisma.Decimal(c.esc),
          cusaPhpSqm: new Prisma.Decimal(c.cusa),
          leaseTermYears: c.term,
          fitoutMonths: c.fitout,
          observedDate: new Date(c.date),
          truthLayer: c.truth,
          sampleSource: c.source,
        },
      });
      compCount++;
    }
  }

  console.log('Seed complete:');
  console.log(`  methodology chunks: ${chunkCount}`);
  console.log(`  lease comps (Makati CBD + BGC / inline): ${compCount}`);
  console.log(`  franchisor: Macao Imperial Tea (${FRANCHISOR_ID})`);
  console.log(`  outlets: ${outlets.length}`);
  console.log('  users: admin@grid.test / analyst@grid.test / broker@grid.test / owner@macaoimperial.test');
  console.log('  password (all demo users): bsa-demo-1234');
  console.log(`  demo run id: ${run.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
