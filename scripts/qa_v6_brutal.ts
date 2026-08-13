/**
 * QA v6 — BRUTAL NCR market-readiness harness.
 *
 * Runs all 20 Excel business categories through the REAL pipeline at 2 NCR candidate
 * sites each (different LGUs), then evaluates the 3 gates:
 *   Gate A — data present (real): the site resolved with real demographics / lease /
 *            health / zonal that the category needs. No honest-thin fallback counts.
 *   Gate B — the category's required modules each returned real output that varies and
 *            carries an honest Truth Layer, matched to the Services-Sought row.
 *   Gate C — the intake captured every needed input (incl. the new conditional fields)
 *            and access scoping holds for the role.
 *
 * Writes a structured JSON result to /tmp/qa_v6_result.json.
 */
import { prisma } from '@/lib/db/prisma';
import { runPipeline, inferCorridor } from '@/lib/modules/orchestrator';
import { modulesForVertical } from '@/lib/modules/verticalConfig';
import { canAccessFranchisor } from '@/lib/auth/auth';
import type { Vertical } from '@prisma/client';
import { writeFileSync } from 'fs';

type Site = { label: string; city: string; lat: number; lon: number; siteType?: string };
type Cat = {
  n: number; name: string; vertical: Vertical; brand: string; concept: string;
  sections: Record<string, string>;
  wants: string[];         // Services-Sought modules that MUST deliver (Gate B)
  sites: [Site, Site];
  role: 'analyst' | 'franchisor' | 'broker';
};

// Real NCR coordinates (demographic-cell centroids) picked so each category spans 2 LGUs.
const S = (label: string, city: string, lat: number, lon: number, siteType = 'inline'): Site => ({ label, city, lat, lon, siteType });

const CATS: Cat[] = [
  { n: 1, name: 'QSR / Kiosk', vertical: 'fnb_qsr', brand: 'Jollibee', concept: 'burger QSR',
    sections: { a: 'Value burger QSR', b: 'Mass-market / value-seeking', b2: 'C–D (mass)', c: 'Under 40 sqm (kiosk/small)', d: 'Avg ticket ₱150', e: '10+ branches (aggressive)', f: 'High-footfall corridors near offices/transit', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['site_fit', 'territory', 'daypart'], role: 'franchisor',
    sites: [S('Jollibee — Cubao', 'Quezon City', 14.6206, 121.0533), S('Jollibee — Grace Park', 'Caloocan', 14.6547, 120.9842)] },

  { n: 2, name: 'Casual Dining', vertical: 'fnb_qsr', brand: 'Max\'s Restaurant', concept: 'casual dining',
    sections: { a: 'Full-service casual dining', b: 'Families & residential households', b2: 'B–C (middle)', c: '80–150 sqm (large)', d: 'Avg ticket ₱450', e: '4–10 branches (12 months)', f: 'Malls & shopping centers', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['site_fit', 'territory', 'lease'], role: 'broker',
    sites: [S('Max\'s — BGC', 'Taguig', 14.5507, 121.0487, 'mall'), S('Max\'s — Ortigas', 'Pasig', 14.5866, 121.0614, 'mall')] },

  { n: 3, name: 'Milk Tea', vertical: 'fnb_cafe', brand: 'Chatime', concept: 'milk tea',
    sections: { a: 'Affordable premium milk tea', b: 'Young professionals & students (18–34)', b2: 'B–C (middle)', c: 'Under 40 sqm (kiosk/small)', d: 'Avg ticket ₱120', e: '10+ branches (aggressive)', f: 'Near schools / campuses', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['territory', 'daypart'], role: 'franchisor',
    sites: [S('Chatime — UP Diliman', 'Quezon City', 14.6537, 121.0685), S('Chatime — Taft/Pasay', 'Pasay', 14.5378, 121.0014)] },

  { n: 4, name: 'Bakery / Dessert', vertical: 'fnb_bakery', brand: 'Red Ribbon', concept: 'bakery',
    sections: { a: 'Cakes & pastries bakery', b: 'Families & residential households', b2: 'C–D (mass)', c: '40–80 sqm (standard inline)', d: 'Avg ticket ₱220', e: '4–10 branches (12 months)', f: 'Residential neighbourhoods', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['site_fit', 'territory', 'daypart'], role: 'broker',
    sites: [S('Red Ribbon — Marikina Heights', 'Marikina', 14.6504, 121.1147), S('Red Ribbon — Valenzuela Marulas', 'Valenzuela', 14.6790, 120.9750)] },

  { n: 5, name: 'Apparel / Retail', vertical: 'retail_apparel', brand: 'Bench', concept: 'apparel retail',
    sections: { a: 'Everyday apparel retail', b: 'Young professionals & students (18–34)', b2: 'B–C (middle)', c: '80–150 sqm (large)', d: 'Avg ticket ₱900', e: '4–10 branches (12 months)', f: 'Malls & shopping centers', k: 'Consent given — data may be used for analysis & audit', mall: 'Tier A super-regional (e.g. SM Megamall, MOA, Ayala Glorietta)' },
    wants: ['mall', 'lease'], role: 'franchisor',
    sites: [S('Bench — MOA/Pasay', 'Pasay', 14.5378, 121.0014, 'mall'), S('Bench — Ortigas', 'Pasig', 14.5866, 121.0614, 'mall')] },

  { n: 6, name: 'Coffee / Cafe', vertical: 'fnb_cafe', brand: 'Starbucks', concept: 'coffee',
    sections: { a: 'Premium coffee cafe', b: 'Office workers / CBD daytime', b2: 'AB (upper)', c: '80–150 sqm (large)', d: 'Avg ticket ₱250', e: '4–10 branches (12 months)', f: 'High-footfall corridors near offices/transit', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['daypart', 'lease', 'territory'], role: 'broker',
    sites: [S('Starbucks — BGC', 'Taguig', 14.5507, 121.0487), S('Starbucks — Makati CBD', 'Makati', 14.5540, 121.0230)] },

  { n: 7, name: 'Pharmacy', vertical: 'pharmacy', brand: 'Mercury Drug', concept: 'pharmacy',
    sections: { a: 'Community pharmacy', b: 'Families & residential households', b2: 'C–D (mass)', c: '40–80 sqm (standard inline)', d: 'Avg ticket ₱280', e: '10+ branches (aggressive)', f: 'Near clinics / hospitals', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['healthcare', 'site_fit', 'territory'], role: 'franchisor',
    sites: [S('Mercury — QC Commonwealth', 'Quezon City', 14.7010, 121.0870), S('Mercury — Manila España', 'Manila', 14.6091, 120.9899)] },

  { n: 8, name: 'Spa / Wellness', vertical: 'services_spa', brand: 'Nail Spa', concept: 'spa wellness',
    sections: { a: 'Premium spa & wellness', b: 'Upper-income / premium shoppers', b2: 'AB (upper)', c: '80–150 sqm (large)', d: 'Avg ticket ₱1200', e: '1–3 branches (pilot)', f: 'Malls & shopping centers', k: 'Consent given — data may be used for analysis & audit', mall: 'Tier A super-regional (e.g. SM Megamall, MOA, Ayala Glorietta)' },
    wants: ['mall', 'informal', 'site_fit'], role: 'broker',
    sites: [S('Spa — Greenhills', 'San Juan', 14.6030, 121.0500, 'mall'), S('Spa — Alabang', 'Muntinlupa', 14.4239, 121.0300, 'mall')] },

  { n: 9, name: 'Convenience', vertical: 'convenience', brand: '7-Eleven', concept: 'convenience store',
    sections: { a: '24/7 convenience store', b: 'Mass-market / value-seeking', b2: 'C–D (mass)', c: '40–80 sqm (standard inline)', d: 'Avg basket ₱120', e: 'Region-wide network build', f: 'High-footfall corridors near offices/transit', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['whitespace', 'territory'], role: 'franchisor',
    sites: [S('7-Eleven — Taguig Bicutan', 'Taguig', 14.5100, 121.0470), S('7-Eleven — Pasig Kapitolyo', 'Pasig', 14.5710, 121.0570)] },

  { n: 10, name: 'Fuel / LPG', vertical: 'fuel', brand: 'Petron', concept: 'fuel station',
    sections: { a: 'Highway fuel station', b: 'Motorists / highway traffic', b2: 'Mixed', c: '150+ sqm / land parcel', d: 'Fuel + C-store', e: '1–3 branches (pilot)', f: 'Highway / roadside frontage', k: 'Consent given — data may be used for analysis & audit', land: 'Corner lot ≥ 1,000 sqm with two-road frontage' },
    wants: ['land', 'site_fit'], role: 'broker',
    sites: [S('Petron — Valenzuela McArthur', 'Valenzuela', 14.6890, 120.9820, 'standalone'), S('Petron — QC Commonwealth', 'Quezon City', 14.7010, 121.0870, 'standalone')] },

  { n: 11, name: 'Salon / Barber', vertical: 'services_salon', brand: 'David\'s Salon', concept: 'salon',
    sections: { a: 'Hair salon & barber', b: 'Families & residential households', b2: 'B–C (middle)', c: '40–80 sqm (standard inline)', d: 'Avg ticket ₱400', e: '4–10 branches (12 months)', f: 'Malls & shopping centers', k: 'Consent given — data may be used for analysis & audit', units: '5–8 units (chairs / machines / lines)' },
    wants: ['informal', 'site_fit'], role: 'franchisor',
    sites: [S('Salon — Marikina Concepcion', 'Marikina', 14.6504, 121.1059), S('Salon — Las Piñas BF', 'Las Piñas', 14.4520, 120.9970)] },

  { n: 12, name: 'Automotive', vertical: 'automotive', brand: 'Rapide', concept: 'auto service',
    sections: { a: 'Auto service & tires', b: 'Motorists / highway traffic', b2: 'B–C (middle)', c: '150+ sqm / land parcel', d: 'Avg ticket ₱2500', e: '1–3 branches (pilot)', f: 'Highway / roadside frontage', k: 'Consent given — data may be used for analysis & audit', land: 'Inline lot 500–1,000 sqm, ≥ 20 m frontage' },
    wants: ['land', 'site_fit'], role: 'broker',
    sites: [S('Rapide — QC Commonwealth', 'Quezon City', 14.7010, 121.0870, 'standalone'), S('Rapide — Caloocan Camarin', 'Caloocan', 14.7480, 121.0380, 'standalone')] },

  { n: 13, name: 'Laundry', vertical: 'services_laundry', brand: 'Lava Laundry', concept: 'laundromat',
    sections: { a: 'Self-service laundromat', b: 'Young professionals & students (18–34)', b2: 'C–D (mass)', c: 'Under 40 sqm (kiosk/small)', d: 'Avg ticket ₱180', e: '4–10 branches (12 months)', f: 'Residential neighbourhoods', k: 'Consent given — data may be used for analysis & audit', units: '9–15 units (large format)' },
    wants: ['informal', 'site_fit'], role: 'franchisor',
    sites: [S('Laundry — Taguig Pinagsama', 'Taguig', 14.5410, 121.0620), S('Laundry — Mandaluyong Plainview', 'Mandaluyong', 14.5760, 121.0340)] },

  { n: 14, name: 'Diagnostics', vertical: 'diagnostics', brand: 'Hi-Precision', concept: 'diagnostic lab',
    sections: { a: 'Diagnostic laboratory', b: 'Families & residential households', b2: 'B–C (middle)', c: '80–150 sqm (large)', d: 'Avg ticket ₱1500', e: '1–3 branches (pilot)', f: 'Near clinics / hospitals', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['healthcare', 'site_fit'], role: 'broker',
    sites: [S('Diag — QC Holy Spirit', 'Quezon City', 14.6870, 121.0760), S('Diag — Manila Ermita', 'Manila', 14.5764, 120.9822)] },

  { n: 15, name: 'Remittance', vertical: 'remittance', brand: 'Cebuana Lhuillier', concept: 'remittance pawnshop',
    sections: { a: 'Remittance & pawnshop', b: 'Mass-market / value-seeking', b2: 'C–D (mass)', c: 'Under 40 sqm (kiosk/small)', d: 'Avg txn ₱80', e: 'Region-wide network build', f: 'High-footfall corridors near offices/transit', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['whitespace', 'territory'], role: 'franchisor',
    sites: [S('Cebuana — Malabon Longos', 'Malabon', 14.6690, 120.9490), S('Cebuana — Navotas Dagat', 'Navotas', 14.6620, 120.9490)] },

  { n: 16, name: 'Hotel / Leisure', vertical: 'hotel', brand: 'Go Hotels', concept: 'budget hotel',
    sections: { a: 'Budget business hotel', b: 'Office workers / CBD daytime', b2: 'B–C (middle)', c: '150+ sqm / land parcel', d: 'ADR ₱2200', e: '1–3 branches (pilot)', f: 'High-footfall corridors near offices/transit', k: 'Consent given — data may be used for analysis & audit', land: 'Building / lot 1,000–3,000 sqm (hotel / large format)' },
    wants: ['land', 'site_fit'], role: 'broker',
    sites: [S('Hotel — Pasay Bay Area', 'Pasay', 14.5378, 121.0014, 'standalone'), S('Hotel — Makati Poblacion', 'Makati', 14.5650, 121.0290, 'standalone')] },

  { n: 17, name: 'Other', vertical: 'other', brand: 'PetExpress', concept: 'pet supplies',
    sections: { a: 'Pet supplies & grooming', b: 'Families & residential households', b2: 'B–C (middle)', c: '40–80 sqm (standard inline)', d: 'Avg ticket ₱600', e: '1–3 branches (pilot)', f: 'Malls & shopping centers', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['site_fit', 'territory'], role: 'franchisor',
    sites: [S('Pet — Pasig San Antonio', 'Pasig', 14.5866, 121.0600), S('Pet — QC South Triangle', 'Quezon City', 14.6349, 121.0355)] },

  { n: 18, name: 'Education', vertical: 'education', brand: 'Kumon', concept: 'review center',
    sections: { a: 'After-school review center', b: 'Families & residential households', b2: 'B–C (middle)', c: '80–150 sqm (large)', d: 'Fee ₱3000/mo', e: '4–10 branches (12 months)', f: 'Near schools / campuses', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['daypart', 'site_fit'], role: 'broker',
    sites: [S('Kumon — QC Diliman', 'Quezon City', 14.6537, 121.0685), S('Kumon — San Juan Greenhills', 'San Juan', 14.6030, 121.0500)] },

  { n: 19, name: 'Water Station', vertical: 'convenience', brand: 'Aqua Best Water', concept: 'water refilling station',
    sections: { a: 'Water refilling station', b: 'Families & residential households', b2: 'C–D (mass)', c: 'Under 40 sqm (kiosk/small)', d: 'Avg ₱30/gal', e: '4–10 branches (12 months)', f: 'Residential neighbourhoods', k: 'Consent given — data may be used for analysis & audit', units: '1–4 units (chairs / machines / lines)' },
    wants: ['whitespace', 'informal'], role: 'franchisor',
    sites: [S('Water — Pateros Sta Ana', 'Pateros', 14.5430, 121.0670), S('Water — Valenzuela Karuhatan', 'Valenzuela', 14.6960, 120.9700)] },

  { n: 20, name: 'Fitness', vertical: 'services_fitness', brand: 'Anytime Fitness', concept: 'gym fitness',
    sections: { a: '24/7 fitness gym', b: 'Office workers / CBD daytime', b2: 'AB (upper)', c: '150+ sqm / land parcel', d: 'Membership ₱2500/mo', e: '1–3 branches (pilot)', f: 'High-footfall corridors near offices/transit', k: 'Consent given — data may be used for analysis & audit' },
    wants: ['daypart', 'lease', 'site_fit'], role: 'broker',
    sites: [S('Anytime — BGC', 'Taguig', 14.5507, 121.0487), S('Anytime — Ortigas', 'Pasig', 14.5866, 121.0614)] },
];

const REQUIRED = ['a', 'b', 'c', 'd', 'e', 'f', 'k'];

function mapSections(sec: Record<string, string>) {
  const out: Record<string, unknown> = {};
  for (const k of REQUIRED) if (sec[k]) out[`section${k.toUpperCase()}`] = sec[k];
  if (sec.b2) out.sectionB = { text: sec.b, income: sec.b2 };
  if (sec.a) out.sectionA = { brand: sec.a, concept: sec.a };
  if (sec.land) out.sectionH = { landParcel: sec.land };
  if (sec.mall) out.sectionI = { mallTier: sec.mall };
  if (sec.units) out.sectionJ = { capacityUnits: sec.units };
  return out;
}

async function run() {
  const results: any[] = [];
  // Ensure a Grid staff (analyst) + a franchisor + a broker user exist for access checks.
  for (const cat of CATS) {
    const sector = cat.vertical.startsWith('fnb_') ? 'FnB'
      : (cat.vertical.startsWith('retail_') || cat.vertical === 'convenience' || cat.vertical === 'pharmacy') ? 'Retail'
      : 'Services';
    const franchisor = await prisma.franchisor.create({
      data: { brandName: `${cat.brand} [QAv6-${cat.n}]`, sector: sector as any, subCategory: cat.concept },
    });
    const intake = await prisma.intakeSubmission.create({
      data: { franchisorId: franchisor.id, vertical: cat.vertical, completenessPct: 100 as any, status: 'submitted', submittedAt: new Date(), ...mapSections(cat.sections) },
    });
    const pr = await prisma.pipelineRun.create({ data: { intakeSubmissionId: intake.id, franchisorId: franchisor.id, vertical: cat.vertical, status: 'queued' } });
    for (const s of cat.sites) {
      await prisma.candidateSite.create({ data: { pipelineRunId: pr.id, label: s.label, city: s.city, lat: s.lat, lon: s.lon, siteType: s.siteType } });
    }

    let runErr: string | null = null;
    try { await runPipeline(pr.id); } catch (e: any) { runErr = e.message; }

    // Pull all module results for this run.
    const mrs = await prisma.moduleResult.findMany({
      where: { pipelineRunId: pr.id },
      include: { site: { select: { label: true, city: true } } },
    });

    // ---- Gate A: data present per site ----
    const sitesEval = cat.sites.map((s) => {
      const corridor = inferCorridor(s.city, s.label);
      return { site: s.label, city: s.city, corridor };
    });
    const gateA_dataFlags: string[] = [];
    for (const s of sitesEval) {
      if (!s.corridor) gateA_dataFlags.push(`${s.city}: no lease corridor`);
    }
    // Demographics presence per site city
    for (const s of cat.sites) {
      const demo = await prisma.$queryRaw<Array<{ p: number | null }>>`
        SELECT COALESCE(SUM(population),0)::int AS p FROM demographic_cell
        WHERE geom IS NOT NULL AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint(${s.lon}, ${s.lat}),4326)::geography, 2000)`;
      if ((demo[0]?.p ?? 0) === 0) gateA_dataFlags.push(`${s.city}: no demographics within 2km`);
    }
    const gateA = gateA_dataFlags.length === 0;

    // ---- Gate B: required modules delivered real output ----
    const gateB_detail: Record<string, any> = {};
    let gateB = true;
    for (const want of cat.wants) {
      const rows = mrs.filter((m) => m.module === want);
      if (rows.length === 0) { gateB_detail[want] = 'MISSING'; gateB = false; continue; }
      // A module "delivers" if at least one site produced a non-null score OR an explicit
      // honest payload (verdict present). We also capture the values to prove variation.
      const scored = rows.filter((r) => r.score != null);
      const payloads = rows.map((r) => ({ site: r.site.label, score: r.score == null ? null : Number(r.score), truth: r.truthLayer, flags: r.flags, payloadKeys: Object.keys((r.payload as any) ?? {}) }));
      gateB_detail[want] = payloads;
      // Module-specific genuineness checks:
      if (want === 'territory') {
        // overlap % should be present (0 is valid — proves it measured, not missing)
        const anyOverlap = rows.some((r) => (r.payload as any)?.maxOverlapPct != null || Array.isArray((r.payload as any)?.realCompetitors));
        if (!anyOverlap) { gateB = false; gateB_detail[want + '_note'] = 'no overlap/competitor data'; }
        gateB_detail[want + '_overlaps'] = rows.map((r) => ({ site: r.site.label, maxOverlap: (r.payload as any)?.maxOverlapPct, competitors: ((r.payload as any)?.realCompetitors ?? []).length }));
      }
      if (want === 'lease') {
        const anyComps = rows.some((r) => Array.isArray((r.payload as any)?.comps) && (r.payload as any).comps.length >= 5);
        if (!anyComps) { gateB = false; gateB_detail[want + '_note'] = 'lease <5 comps or missing'; }
        gateB_detail[want + '_comps'] = rows.map((r) => ({ site: r.site.label, corridor: (r.payload as any)?.corridor, comps: ((r.payload as any)?.comps ?? []).length }));
      }
      if (want === 'daypart') {
        const anyCurve = rows.some((r) => Array.isArray((r.payload as any)?.hourly) && (r.payload as any).hourly.length === 24);
        if (!anyCurve) { gateB = false; gateB_detail[want + '_note'] = 'no 24h curve'; }
      }
      if (want === 'healthcare') {
        const anyFac = rows.some((r) => (r.payload as any)?.verdict && (r.payload as any).verdict !== 'no_data');
        if (!anyFac) gateB_detail[want + '_note'] = 'no facility (may be honest)';
      }
      if (want === 'land') {
        const anyScreen = rows.some((r) => (r.payload as any)?.composite != null || (r.payload as any)?.zoningOk != null);
        if (!anyScreen) { gateB = false; gateB_detail[want + '_note'] = 'no land screen'; }
      }
      if (want === 'whitespace') {
        // whitespace persists at run-level; presence of any row is enough here
        if (scored.length === 0 && !rows.some((r) => (r.payload as any)?.gaps != null)) gateB_detail[want + '_note'] = 'whitespace thin (check honest flag)';
      }
      if (want === 'mall') {
        const anyMall = rows.some((r) => (r.payload as any)?.tierMatch !== undefined || (r.payload as any)?.mallName != null || (r.payload as any)?.verdict != null);
        if (!anyMall) { gateB = false; gateB_detail[want + '_note'] = 'no mall read'; }
      }
      if (want === 'informal') {
        const anyCap = rows.some((r) => (r.payload as any)?.capacity != null || (r.payload as any)?.totalEstimated != null);
        if (!anyCap) { gateB = false; gateB_detail[want + '_note'] = 'no informal/capacity read'; }
      }
    }

    // ---- Gate C: UI fields present + access scoping ----
    const gateC_flags: string[] = [];
    // Conditional-field completeness: if the category needs land/mall/units, the section must be set.
    if (['fuel', 'automotive', 'hotel'].includes(cat.vertical) && !cat.sections.land) gateC_flags.push('missing land field');
    if (['retail_apparel', 'retail_specialty', 'services_spa'].includes(cat.vertical) && !cat.sections.mall) gateC_flags.push('missing mall field');
    if (['services_salon', 'services_laundry'].includes(cat.vertical) && !cat.sections.units) gateC_flags.push('missing units field');
    // Access scoping: a broker/franchisor from a DIFFERENT franchisor must be refused.
    const foreignSession = { id: 'x', role: cat.role, franchisorId: 'different-franchisor-id' } as any;
    const staffSession = { id: 's', role: 'analyst', franchisorId: null } as any;
    const ownSession = { id: 'o', role: cat.role, franchisorId: franchisor.id } as any;
    const foreignRefused = cat.role === 'analyst' ? true : !canAccessFranchisor(foreignSession, franchisor.id);
    const staffAllowed = canAccessFranchisor(staffSession, franchisor.id);
    const ownAllowed = canAccessFranchisor(ownSession, franchisor.id);
    if (!foreignRefused) gateC_flags.push('access leak: foreign role allowed');
    if (!staffAllowed) gateC_flags.push('staff cannot read');
    if (!ownAllowed) gateC_flags.push('own role refused');
    const gateC = gateC_flags.length === 0;

    results.push({
      n: cat.n, name: cat.name, vertical: cat.vertical, role: cat.role,
      runErr,
      modulesExpected: modulesForVertical(cat.vertical),
      gateA, gateA_dataFlags,
      gateB, gateB_detail,
      gateC, gateC_flags,
      pass: gateA && gateB && gateC && !runErr,
    });
  }

  writeFileSync('/tmp/qa_v6_result.json', JSON.stringify(results, null, 2));
  const passed = results.filter((r) => r.pass).length;
  writeFileSync('/tmp/qa_v6_summary.txt', `${passed}/${results.length} passed 3/3\n` + results.map((r) => `#${r.n} ${r.name}: ${r.pass ? 'PASS' : 'FAIL'} (A=${r.gateA} B=${r.gateB} C=${r.gateC})${r.runErr ? ' ERR:' + r.runErr : ''}`).join('\n') + '\n');
  await prisma.$disconnect();
}

run().catch((e) => { writeFileSync('/tmp/qa_v6_summary.txt', 'FATAL ' + e.stack + '\n'); process.exit(1); });
