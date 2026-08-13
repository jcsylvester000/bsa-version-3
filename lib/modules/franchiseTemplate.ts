/**
 * Franchise template → intake prefill.
 *
 * Turns a brand's imported franchise requirements (fee, investment, min space, ROI,
 * staffing…) into intake `sections` the wizard can drop in. Pure + deterministic so it
 * unit-tests cleanly. Values map to the EXACT intakeOptions option strings where a field
 * is a dropdown, so the prefill renders selected (not blank). Fields we can't infer are
 * left out (the user fills them). Nothing here is presented as hard fact — the requirements
 * carry their own Truth Layer, shown separately in the UI.
 */
import { FOOTPRINT, TARGET_CUSTOMER, SITE_PREFERENCE, INCOME_BAND, EXPANSION_GOAL } from '@/lib/modules/intakeOptions';

export interface FranchiseRequirements {
  brand?: string; franchisor?: string; vertical?: string; category?: string;
  franchiseFee?: string | null; totalInvestment?: string | null; minSpace?: string | null;
  contractTerm?: string | null; royalty?: string | null; roiPayback?: string | null;
  staffing?: string | null; support?: string | null; scaling?: string | null;
  truthLayer?: string | null; confidence?: string | null; source?: string | null;
  // Provenance + membership markers (added with the PFA Members Directory import).
  // `dataset` tags where a record came from ("PFA" for PFA-directory brands; absent =
  // the original hand-built catalogue). `memberType` = "supplier" marks an Allied /
  // supplier member (not a franchise offer) so screening can de-prioritize it.
  dataset?: string | null; memberType?: string | null;
  // Optional cash-flow figures carried from the PFA "Top 20 Cash Flow" sheet.
  monthlyCashFlow?: string | null; annualCashFlow?: string | null; bestArea?: string | null;
}

/**
 * Extract the smallest sqm number from a free-text space string. Handles ranges like
 * "15–30 sqm" (captures the 15, not just the 30) and multiple segments
 * "Pop-up 15–30 sqm / Inline 50–80 sqm". Ignores non-sqm numbers (e.g. "frontage 13m").
 */
export function parseMinSqm(space: string | null | undefined): number | null {
  if (!space) return null;
  const nums: number[] = [];
  // Match a range "A–B sqm" (any dash) OR a single "N sqm"; take the low end of a range.
  for (const m of space.matchAll(/(\d[\d,]*)\s*[–\-—to]+\s*(\d[\d,]*)\s*sqm/gi)) {
    nums.push(Number(m[1].replace(/,/g, '')));
  }
  for (const m of space.matchAll(/(?<![\d–\-—])(\d[\d,]*)\s*sqm/gi)) {
    nums.push(Number(m[1].replace(/,/g, '')));
  }
  if (!nums.length) return null;
  return Math.min(...nums);
}

/** Map a min-sqm to the closest FOOTPRINT option value. */
function footprintFor(space: string | null | undefined): string | undefined {
  const sqm = parseMinSqm(space);
  if (sqm == null) return undefined;
  if (sqm < 40) return FOOTPRINT[0].value;      // Under 40 sqm (kiosk/small)
  if (sqm <= 80) return FOOTPRINT[1].value;     // 40–80 sqm
  if (sqm <= 150) return FOOTPRINT[2].value;    // 80–150 sqm
  return FOOTPRINT[3].value;                     // 150+ sqm / land parcel
}

/** Sensible per-vertical defaults for the fields the sheet doesn't state. */
const VERTICAL_DEFAULTS: Record<string, { b?: string; b2?: string; f?: string }> = {
  fnb_qsr: { b: TARGET_CUSTOMER[4].value /* Mass-market / value-seeking */, b2: INCOME_BAND[2].value /* C–D */, f: SITE_PREFERENCE[0].value /* offices/transit */ },
  fnb_cafe: { b: TARGET_CUSTOMER[0].value /* young pros/students */, b2: INCOME_BAND[1].value /* B–C */, f: SITE_PREFERENCE[0].value },
  fnb_bakery: { b: TARGET_CUSTOMER[1].value /* families */, b2: INCOME_BAND[2].value, f: SITE_PREFERENCE[2].value /* residential */ },
  convenience: { b: TARGET_CUSTOMER[4].value, b2: INCOME_BAND[2].value, f: SITE_PREFERENCE[0].value },
  services_salon: { b: TARGET_CUSTOMER[1].value, b2: INCOME_BAND[1].value, f: SITE_PREFERENCE[1].value /* malls */ },
  services_laundry: { b: TARGET_CUSTOMER[0].value, b2: INCOME_BAND[2].value, f: SITE_PREFERENCE[2].value },
  services_fitness: { b: TARGET_CUSTOMER[2].value /* office/CBD daytime */, b2: INCOME_BAND[1].value, f: SITE_PREFERENCE[0].value },
  education: { b: TARGET_CUSTOMER[1].value, b2: INCOME_BAND[1].value, f: SITE_PREFERENCE[3].value /* near schools */ },
  remittance: { b: TARGET_CUSTOMER[4].value, b2: INCOME_BAND[2].value, f: SITE_PREFERENCE[0].value },
};

/**
 * Build intake sections (a,b,b2,c,d,e,f) from a brand's requirements. Only fills what we
 * can support honestly; the user edits the rest. `d` (unit economics) carries the real
 * fee/investment/ROI so the brief reflects the actual template figures.
 */
export function prefillFromRequirements(r: FranchiseRequirements): Record<string, string> {
  const v = r.vertical ?? 'other';
  const d = VERTICAL_DEFAULTS[v] ?? {};
  const sections: Record<string, string> = {};

  // a — brand & concept
  sections.a = [r.brand, r.category].filter(Boolean).join(' — ') || (r.brand ?? '');
  // b / b2 / f — sensible vertical defaults
  if (d.b) sections.b = d.b;
  if (d.b2) sections.b2 = d.b2;
  if (d.f) sections.f = d.f;
  // c — footprint from the real min-space requirement
  const fp = footprintFor(r.minSpace);
  if (fp) sections.c = fp;
  // d — unit economics: the actual template figures (fee / investment / ROI / staffing)
  const econ: string[] = [];
  if (r.franchiseFee) econ.push(`Fee ${r.franchiseFee}`);
  if (r.totalInvestment) econ.push(`Investment ${r.totalInvestment}`);
  if (r.roiPayback) econ.push(`ROI ${r.roiPayback}`);
  if (r.staffing) econ.push(`Staff ${r.staffing}`);
  if (econ.length) sections.d = econ.join(' · ') + (r.truthLayer ? ` (${r.truthLayer})` : '');
  // e — expansion goal: default to a pilot for a franchisee starting out
  sections.e = EXPANSION_GOAL[0].value; // 1–3 branches (pilot)
  // k — consent default (the wizard also gates on this)
  sections.k = 'Consent given — data may be used for analysis & audit';

  return sections;
}
