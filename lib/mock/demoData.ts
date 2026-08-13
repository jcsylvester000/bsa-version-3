/**
 * In-memory demo data for mock mode — mirrors the seed so the app is fully
 * browsable with no database. Used only when isMockAuth() is true and a DB read
 * fails (or is skipped).
 *
 * REAL DATA: the primary demo is Macao Imperial Tea, a real Philippine milk-tea
 * chain. Outlet names and coordinates are real Metro Manila branches. Sales figures
 * are NOT public, so they are Assumed placeholders carried as illustrative ranges and
 * labelled Assumed wherever shown — never presented as Verified fact. Candidate sites
 * are real corridors. Competitors are pulled live from Google Places at run time.
 *
 * Multi-scenario: DEMO_SCENARIOS holds the primary cafe brand plus real pharmacy /
 * fuel / convenience alternatives so the intake prefill can showcase different
 * verticals on real establishments.
 */
const DEMO_FRANCHISOR_ID = '11111111-1111-1111-1111-111111111111';
const DEMO_RUN_ID = 'mock-run-0000-0000-0000-000000000001';

export const DEMO_RUNS = [
  {
    id: DEMO_RUN_ID,
    brandName: 'Macao Imperial Tea',
    vertical: 'fnb_cafe',
    status: 'ready',
    confidence: null as string | null,
    exclusivityRadiusM: 1500,
    siteCount: 2,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    franchisorId: DEMO_FRANCHISOR_ID,
  },
];

/**
 * Real Macao Imperial Tea Metro Manila branches (names + coordinates are real).
 * A dense BGC/Makati cluster is included so a candidate at BGC produces a
 * meaningful Territory Guard overlap out of the box.
 */
export const DEMO_OUTLETS = [
  { id: 'mock-o1', outletName: 'Macao Imperial Tea — One Ayala', lat: 14.5505, lon: 121.0270, format: 'inline' },
  { id: 'mock-o2', outletName: 'Macao Imperial Tea — Greenhills Mall', lat: 14.6008, lon: 121.0504, format: 'mall' },
  { id: 'mock-o3', outletName: 'Macao Imperial Tea — SM Megamall', lat: 14.5847, lon: 121.0566, format: 'mall' },
  { id: 'mock-o4', outletName: 'Macao Imperial Tea — SM MOA', lat: 14.5355, lon: 120.9820, format: 'mall' },
  { id: 'mock-o5', outletName: 'Macao Imperial Tea — E. Rodriguez', lat: 14.6207, lon: 121.0203, format: 'inline' },
  { id: 'mock-o6', outletName: 'Macao Imperial Tea — Banawe', lat: 14.6360, lon: 121.0016, format: 'inline' },
];

export const DEMO_SITES = [
  { id: 'mock-s1', label: 'Proposed — Makati Ayala Ave', siteType: 'inline', city: 'Makati', lat: 14.5480, lon: 121.0250 },
  { id: 'mock-s2', label: 'Proposed — QC Cubao (Araneta)', siteType: 'inline', city: 'Quezon City', lat: 14.6206, lon: 121.0533 },
];

export const DEMO_CORRIDORS = ['BGC', 'Makati CBD', 'Ortigas'];

/**
 * Corridor lease comps for mock Lease Benchmark — mirror the real seeded corridor
 * bands (published 2026 retail ranges). Verified where sourced from a published
 * band; a couple Assumed estimates carry their basis.
 */
export const DEMO_LEASE_COMPS_BY_CORRIDOR: Record<string, Array<{ baseRentPhpSqm: number; escalationPct: number; cusaPhpSqm: number; leaseTermYears: number; fitoutMonths: number }>> = {
  'Makati CBD': [
    { baseRentPhpSqm: 1800, escalationPct: 5, cusaPhpSqm: 280, leaseTermYears: 5, fitoutMonths: 2 },
    { baseRentPhpSqm: 2000, escalationPct: 5, cusaPhpSqm: 300, leaseTermYears: 5, fitoutMonths: 2 },
    { baseRentPhpSqm: 2200, escalationPct: 6, cusaPhpSqm: 310, leaseTermYears: 6, fitoutMonths: 2 },
    { baseRentPhpSqm: 2400, escalationPct: 6, cusaPhpSqm: 320, leaseTermYears: 6, fitoutMonths: 2 },
    { baseRentPhpSqm: 2600, escalationPct: 6, cusaPhpSqm: 340, leaseTermYears: 7, fitoutMonths: 3 },
    { baseRentPhpSqm: 2800, escalationPct: 6, cusaPhpSqm: 350, leaseTermYears: 7, fitoutMonths: 3 },
    { baseRentPhpSqm: 3000, escalationPct: 7, cusaPhpSqm: 360, leaseTermYears: 7, fitoutMonths: 3 },
  ],
  BGC: [
    { baseRentPhpSqm: 2200, escalationPct: 5, cusaPhpSqm: 320, leaseTermYears: 5, fitoutMonths: 2 },
    { baseRentPhpSqm: 2500, escalationPct: 5, cusaPhpSqm: 340, leaseTermYears: 5, fitoutMonths: 2 },
    { baseRentPhpSqm: 2800, escalationPct: 6, cusaPhpSqm: 360, leaseTermYears: 7, fitoutMonths: 2 },
    { baseRentPhpSqm: 3000, escalationPct: 6, cusaPhpSqm: 380, leaseTermYears: 7, fitoutMonths: 3 },
    { baseRentPhpSqm: 3400, escalationPct: 6, cusaPhpSqm: 400, leaseTermYears: 7, fitoutMonths: 3 },
    { baseRentPhpSqm: 4000, escalationPct: 7, cusaPhpSqm: 440, leaseTermYears: 10, fitoutMonths: 3 },
    { baseRentPhpSqm: 4200, escalationPct: 7, cusaPhpSqm: 450, leaseTermYears: 10, fitoutMonths: 4 },
  ],
};

/** Back-compat alias — default corridor comps (Makati CBD, the primary demo). */
export const DEMO_LEASE_COMPS = DEMO_LEASE_COMPS_BY_CORRIDOR['Makati CBD'];

/**
 * Demo outlet monthly sales for mock Territory Guard cannibalization. NOT public —
 * these are Assumed illustrative placeholders (milk-tea inline branch range), used
 * only to make the mock cannibalization estimate non-zero. Shown as Assumed in the UI.
 */
export const DEMO_OUTLET_SALES: Record<string, number> = {
  'mock-o1': 720000, 'mock-o2': 540000, 'mock-o3': 610000, 'mock-o4': 650000, 'mock-o5': 430000, 'mock-o6': 380000,
};

export function demoSiteById(id: string) {
  return DEMO_SITES.find((s) => s.id === id) ?? null;
}

export function demoRunById(id: string) {
  return DEMO_RUNS.find((r) => r.id === id) ?? DEMO_RUNS[0];
}

export const DEMO_RUN_ID_EXPORT = DEMO_RUN_ID;
export const DEMO_FRANCHISOR_ID_EXPORT = DEMO_FRANCHISOR_ID;

/** Franchisors for the intake picker in mock mode. */
export const DEMO_FRANCHISORS = [{ id: DEMO_FRANCHISOR_ID, brandName: 'Macao Imperial Tea' }];

/* ------------------------------------------------------------------------- *
 * Multi-scenario prefills — real brands across verticals, selectable at intake.
 * Every coordinate is a real Metro Manila location; sales are Assumed placeholders.
 * ------------------------------------------------------------------------- */
export interface PrefillOutlet {
  outletName: string; format: string; address: string; lat: string; lon: string; monthlySalesPhp: string; geocoded: boolean;
}
export interface PrefillCandidate {
  label: string; address: string; city: string; lat: string; lon: string; siteType: string; geocoded: boolean;
}
export interface DemoScenario {
  key: string;
  label: string;
  /** Prisma Vertical enum value. */
  vertical: string;
  brandName: string;
  blurb: string;
  /**
   * Intake section values. Keys a,b,b2,c,d,e,f,k map to the wizard fields. The
   * dropdown fields (b, b2, c, e, f, k) MUST use exact option values from
   * lib/modules/intakeOptions.ts, or the select renders blank — every value below
   * is copied verbatim from those option lists so "Load demo data" fills every field.
   */
  sections: Record<string, string>;
  outlets: PrefillOutlet[];
  candidates: PrefillCandidate[];
  /** When set, this is an INDEPENDENT (non-franchise) demo: name + comparable brand. */
  independent?: { name: string; comparableBrand: string };
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  // 1 — Milk tea / cafe. Ayala candidate cannibalizes an existing branch (75% overlap);
  // Ortigas candidate is clean territory with dense competition. Both data-rich.
  {
    key: 'cafe',
    label: '1 · Milk tea — Macao Imperial Tea',
    vertical: 'fnb_cafe',
    brandName: 'Macao Imperial Tea',
    blurb: 'Milk-tea chain scouting Ayala vs Ortigas against its own NCR network — Territory, Lease, Daypart.',
    sections: {
      a: 'Macao Imperial Tea — premium milk tea with a signature cheese-tea series',
      b: 'Young professionals & students (18–34)',
      b2: 'B–C (middle)',
      c: '40–80 sqm (standard inline)',
      d: 'Avg ticket ₱150; target ₱500k–₱750k monthly per branch (Assumed — chain sales not public)',
      e: '4–10 branches (12 months)',
      f: 'High-footfall corridors near offices/transit',
      k: 'Consent given — data may be used for analysis & audit',
    },
    outlets: [
      { outletName: 'Macao Imperial Tea — One Ayala', format: 'inline', address: 'One Ayala, Makati', lat: '14.5505', lon: '121.0270', monthlySalesPhp: '720000', geocoded: true },
      { outletName: 'Macao Imperial Tea — Greenhills Mall', format: 'mall', address: 'Greenhills, San Juan', lat: '14.6008', lon: '121.0504', monthlySalesPhp: '540000', geocoded: true },
      { outletName: 'Macao Imperial Tea — SM Megamall', format: 'mall', address: 'SM Megamall, Mandaluyong', lat: '14.5847', lon: '121.0566', monthlySalesPhp: '610000', geocoded: true },
      { outletName: 'Macao Imperial Tea — SM MOA', format: 'mall', address: 'SM Mall of Asia, Pasay', lat: '14.5355', lon: '120.9820', monthlySalesPhp: '650000', geocoded: true },
      { outletName: 'Macao Imperial Tea — E. Rodriguez', format: 'inline', address: 'E. Rodriguez Ave, Quezon City', lat: '14.6207', lon: '121.0203', monthlySalesPhp: '430000', geocoded: true },
    ],
    candidates: [
      { label: 'Proposed — Makati Ayala Ave', address: 'Ayala Avenue, Makati', city: 'Makati', lat: '14.5480', lon: '121.0250', siteType: 'inline', geocoded: true },
      { label: 'Proposed — Ortigas Center', address: 'Ortigas Center, Pasig', city: 'Pasig', lat: '14.5866', lon: '121.0614', siteType: 'inline', geocoded: true },
    ],
  },

  // 2 — QSR. BGC (office-led, dense) vs Manila Espana (huge residential). Contrasting daypart.
  {
    key: 'qsr',
    label: '2 · QSR — Jollibee',
    vertical: 'fnb_qsr',
    brandName: 'Jollibee',
    blurb: 'Market-leading QSR comparing an office-led BGC slot with a dense residential Manila corridor.',
    sections: {
      a: 'Jollibee — value burger & chicken QSR, family dining',
      b: 'Families & residential households',
      b2: 'C–D (mass)',
      c: '80–150 sqm (large)',
      d: 'Avg ticket ₱180; branch sales not public (Assumed)',
      e: '10+ branches (aggressive)',
      f: 'High-footfall corridors near offices/transit',
      k: 'Consent given — data may be used for analysis & audit',
    },
    outlets: [
      { outletName: 'Jollibee — BGC Bonifacio High Street', format: 'inline', address: 'BGC, Taguig', lat: '14.5520', lon: '121.0490', monthlySalesPhp: '', geocoded: true },
      { outletName: 'Jollibee — Cubao', format: 'inline', address: 'Cubao, Quezon City', lat: '14.6206', lon: '121.0530', monthlySalesPhp: '', geocoded: true },
      { outletName: 'Jollibee — España', format: 'inline', address: 'España, Manila', lat: '14.6100', lon: '120.9905', monthlySalesPhp: '', geocoded: true },
    ],
    candidates: [
      { label: 'Proposed — BGC High Street', address: 'BGC High Street, Taguig', city: 'Taguig', lat: '14.5507', lon: '121.0487', siteType: 'inline', geocoded: true },
      { label: 'Proposed — Manila España', address: 'España Blvd, Manila', city: 'Manila', lat: '14.6091', lon: '120.9899', siteType: 'inline', geocoded: true },
    ],
  },

  // 3 — Coffee. Makati CBD vs Mandaluyong — both office-heavy daytime, dense cafe competition.
  {
    key: 'coffee',
    label: '3 · Coffee — Starbucks',
    vertical: 'fnb_cafe',
    brandName: 'Starbucks',
    blurb: 'Premium coffee reading office-led daypart at Makati CBD vs Mandaluyong, with corridor lease benchmarks.',
    sections: {
      a: 'Starbucks — premium coffee, dwell-time cafe format',
      b: 'Office workers / CBD daytime',
      b2: 'AB (upper)',
      c: '80–150 sqm (large)',
      d: 'Avg ticket ₱250; branch sales not public (Assumed)',
      e: '4–10 branches (12 months)',
      f: 'High-footfall corridors near offices/transit',
      k: 'Consent given — data may be used for analysis & audit',
    },
    outlets: [
      { outletName: 'Starbucks — BGC', format: 'inline', address: 'BGC, Taguig', lat: '14.5507', lon: '121.0487', monthlySalesPhp: '', geocoded: true },
      { outletName: 'Starbucks — Ortigas', format: 'mall', address: 'Ortigas, Pasig', lat: '14.5866', lon: '121.0614', monthlySalesPhp: '', geocoded: true },
      { outletName: 'Starbucks — Greenbelt', format: 'mall', address: 'Greenbelt, Makati', lat: '14.5520', lon: '121.0210', monthlySalesPhp: '', geocoded: true },
    ],
    candidates: [
      { label: 'Proposed — Makati CBD', address: 'Ayala Ave, Makati', city: 'Makati', lat: '14.5547', lon: '121.0244', siteType: 'inline', geocoded: true },
      { label: 'Proposed — Mandaluyong (Shaw)', address: 'Shaw Blvd, Mandaluyong', city: 'Mandaluyong', lat: '14.5794', lon: '121.0359', siteType: 'inline', geocoded: true },
    ],
  },

  // 4 — Pharmacy. Healthcare-proximity read: Manila Espana (38 facilities) vs BGC (38). Both strong.
  {
    key: 'pharmacy',
    label: '4 · Pharmacy — Mercury Drug',
    vertical: 'pharmacy',
    brandName: 'Mercury Drug',
    blurb: 'Community pharmacy scored on healthcare proximity + competition at Manila España vs BGC.',
    sections: {
      a: 'Mercury Drug — community pharmacy near clinics & hospitals',
      b: 'Families & residential households',
      b2: 'C–D (mass)',
      c: '40–80 sqm (standard inline)',
      d: 'Avg ticket ₱280; branch sales not public (Assumed)',
      e: '10+ branches (aggressive)',
      f: 'Near clinics / hospitals',
      k: 'Consent given — data may be used for analysis & audit',
    },
    outlets: [
      { outletName: 'Mercury Drug — Cubao', format: 'inline', address: 'Cubao, Quezon City', lat: '14.6206', lon: '121.0530', monthlySalesPhp: '', geocoded: true },
      { outletName: 'Mercury Drug — Makati Ave', format: 'inline', address: 'Makati Ave, Makati', lat: '14.5620', lon: '121.0270', monthlySalesPhp: '', geocoded: true },
    ],
    candidates: [
      { label: 'Proposed — Manila España', address: 'España Blvd, Manila', city: 'Manila', lat: '14.6091', lon: '120.9899', siteType: 'inline', geocoded: true },
      { label: 'Proposed — BGC', address: 'BGC, Taguig', city: 'Taguig', lat: '14.5507', lon: '121.0487', siteType: 'inline', geocoded: true },
    ],
  },

  // 5 — Convenience. White-Space + Territory across the network: Ortigas vs BGC.
  {
    key: 'convenience',
    label: '5 · Convenience — 7-Eleven',
    vertical: 'convenience',
    brandName: '7-Eleven',
    blurb: 'Convenience network testing white-space and cannibalization at Ortigas vs BGC.',
    sections: {
      a: '7-Eleven — 24/7 convenience store',
      b: 'Mass-market / value-seeking',
      b2: 'C–D (mass)',
      c: '40–80 sqm (standard inline)',
      d: 'Avg basket ₱120; store sales not public (Assumed)',
      e: 'Region-wide network build',
      f: 'High-footfall corridors near offices/transit',
      k: 'Consent given — data may be used for analysis & audit',
    },
    outlets: [
      { outletName: '7-Eleven — Makati CBD', format: 'inline', address: 'Makati CBD', lat: '14.5547', lon: '121.0244', monthlySalesPhp: '', geocoded: true },
      { outletName: '7-Eleven — Cubao', format: 'inline', address: 'Cubao, Quezon City', lat: '14.6206', lon: '121.0530', monthlySalesPhp: '', geocoded: true },
      { outletName: '7-Eleven — Manila España', format: 'inline', address: 'España, Manila', lat: '14.6091', lon: '120.9899', monthlySalesPhp: '', geocoded: true },
    ],
    candidates: [
      { label: 'Proposed — Ortigas Center', address: 'Ortigas Center, Pasig', city: 'Pasig', lat: '14.5866', lon: '121.0614', siteType: 'inline', geocoded: true },
      { label: 'Proposed — BGC High Street', address: 'BGC High Street, Taguig', city: 'Taguig', lat: '14.5507', lon: '121.0487', siteType: 'inline', geocoded: true },
    ],
  },

  // 6 — INDEPENDENT (non-franchise) milk-tea shop, benchmarked against Chatime. Shows
  // that a single-owner operator gets the same scoring as a chain: the comparable brand
  // anchors competitor discrimination, daypart and the lease corridor.
  {
    key: 'independent_tea',
    label: '6 · Independent — BrewLab Tea (like Chatime)',
    vertical: 'fnb_cafe',
    brandName: 'BrewLab Tea',
    blurb: 'A single-owner milk-tea shop benchmarked against Chatime — proves an independent gets full, adapted scoring.',
    independent: { name: 'BrewLab Tea', comparableBrand: 'Chatime' },
    sections: {
      a: 'BrewLab Tea — independent premium milk tea & bubble tea, grab-and-go',
      b: 'Young professionals & students (18–34)',
      b2: 'B–C (middle)',
      c: 'Under 40 sqm (kiosk/small)',
      d: 'Avg ticket ₱135; owner-operated, single location scaling to 2–3',
      e: '1–3 branches (pilot)',
      f: 'High-footfall corridors near offices/transit',
      k: 'Consent given — data may be used for analysis & audit',
    },
    outlets: [
      { outletName: 'BrewLab Tea — Katipunan', format: 'inline', address: 'Katipunan, Quezon City', lat: '14.6390', lon: '121.0740', monthlySalesPhp: '320000', geocoded: true },
    ],
    candidates: [
      { label: 'Proposed — BGC High Street', address: 'BGC High Street, Taguig', city: 'Taguig', lat: '14.5507', lon: '121.0487', siteType: 'inline', geocoded: true },
      { label: 'Proposed — Ortigas Center', address: 'Ortigas Center, Pasig', city: 'Pasig', lat: '14.5866', lon: '121.0614', siteType: 'inline', geocoded: true },
    ],
  },
];

/** Primary prefill (cafe scenario) — the default "Load demo data" fill. */
export const DEMO_INTAKE_PREFILL = {
  vertical: DEMO_SCENARIOS[0].vertical,
  sections: DEMO_SCENARIOS[0].sections,
  outlets: DEMO_SCENARIOS[0].outlets,
  candidates: DEMO_SCENARIOS[0].candidates,
};
