/**
 * Data-integrity validator — the reference-data QA guard.
 *
 *   npm run db:validate           # check every reference dataset, print a report
 *   npm run db:validate -- --json # machine-readable output
 *
 * Reads the curated JSON files in prisma/data and checks each row for:
 *   - required fields present,
 *   - a Truth Layer classification (Verified / Assumed / Projected) where the schema has one,
 *   - a source / provenance string where the schema has one,
 *   - coordinates inside plausible Philippine / Metro-Manila bounds,
 *   - numeric fields inside sane ranges (populations, rents, sqm, percentages).
 *
 * It NEVER mutates data — it only reports. Exit code is non-zero when any ERROR-level issue
 * is found, so it can gate a build/ingest. WARN-level issues (thin provenance) don't fail the
 * run. This encodes what "clean" means for the Truth Layer discipline so hardening is checked,
 * not guessed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'prisma', 'data');
const read = (f: string) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));
const asArray = (d: unknown): any[] => (Array.isArray(d) ? d : Object.values(d as object));

// Philippine bounds (generous) and the tighter Metro-Manila box.
const PH = { lat: [4.5, 21.5], lon: [116.0, 127.0] };
const NCR = { lat: [14.25, 14.85], lon: [120.85, 121.2] };
const TRUTH = new Set(['verified', 'assumed', 'projected']);

interface Issue { dataset: string; row: string; level: 'ERROR' | 'WARN'; field: string; msg: string }
const issues: Issue[] = [];
const err = (dataset: string, row: string, field: string, msg: string) => issues.push({ dataset, row, level: 'ERROR', field, msg });
const warn = (dataset: string, row: string, field: string, msg: string) => issues.push({ dataset, row, level: 'WARN', field, msg });

function checkTruth(dataset: string, row: string, v: unknown) {
  if (v == null || v === '') { warn(dataset, row, 'truthLayer', 'no Truth Layer classification'); return; }
  if (!TRUTH.has(String(v).toLowerCase())) err(dataset, row, 'truthLayer', `invalid Truth Layer "${v}"`);
}
function checkSource(dataset: string, row: string, v: unknown) {
  if (v == null || String(v).trim().length < 5) warn(dataset, row, 'source', 'missing / thin source');
}
function checkCoord(dataset: string, row: string, lat: unknown, lon: unknown, box: { lat: number[]; lon: number[] }) {
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) { err(dataset, row, 'geo', 'missing/invalid coordinates'); return; }
  if (la < box.lat[0] || la > box.lat[1] || lo < box.lon[0] || lo > box.lon[1]) {
    err(dataset, row, 'geo', `coordinate ${la},${lo} outside expected bounds`);
  }
}
function num(dataset: string, row: string, field: string, v: unknown, lo: number, hi: number, level: 'ERROR' | 'WARN' = 'ERROR') {
  if (v == null) return; // missing numeric handled by required-field checks where it matters
  const n = Number(v);
  if (!Number.isFinite(n)) { err(dataset, row, field, `non-numeric "${v}"`); return; }
  if (n < lo || n > hi) issues.push({ dataset, row, level, field, msg: `${field}=${n} outside [${lo}, ${hi}]` });
}

// ---- demographics ----
try {
  const rows = asArray(read('demographics.real.json'));
  const seen = new Set<string>();
  for (const r of rows) {
    const id = `${r.barangay ?? '?'} / ${r.city ?? '?'}`;
    if (!r.psgc_code) err('demographics', id, 'psgc_code', 'missing psgc_code');
    else if (seen.has(r.psgc_code)) err('demographics', id, 'psgc_code', `duplicate psgc_code ${r.psgc_code}`);
    else seen.add(r.psgc_code);
    // Demographics span NCR + Davao (Region XI), so check against PH-wide bounds; a coord
    // that's valid-PH but far from BOTH known clusters is the real "mis-geocoded" signal.
    checkCoord('demographics', id, r.lat, r.lon, PH);
    const la = Number(r.lat), lo = Number(r.lon);
    if (Number.isFinite(la) && Number.isFinite(lo)) {
      // NCR box, plus the wider Davao Region XI (covers Davao City + province: Digos,
      // Tagum, Panabo, IGACOS/Samal, Mati). A coord outside BOTH is the real mis-geocode signal.
      const inNCR = la >= NCR.lat[0] && la <= NCR.lat[1] && lo >= NCR.lon[0] && lo <= NCR.lon[1];
      const inDavaoRegion = la >= 6.6 && la <= 7.6 && lo >= 125.2 && lo <= 126.3;
      if (!inNCR && !inDavaoRegion) warn('demographics', id, 'geo', `coord ${la},${lo} not near NCR or Davao Region — verify placement`);
    }
    num('demographics', id, 'population', r.population, 100, 500_000);
    num('demographics', id, 'renter_share_pct', r.renter_share_pct, 0, 100);
    num('demographics', id, 'daytime_pop', r.daytime_pop, 0, 1_000_000, 'WARN');
    checkTruth('demographics', id, r.truth_layer);
    checkSource('demographics', id, r.source);
  }
  console.log(`demographics: ${rows.length} rows checked`);
} catch (e) { console.log('demographics: skipped', (e as Error).message); }

// ---- lease comps ----
try {
  const rows = asArray(read('lease.real.json'));
  for (const r of rows) {
    const id = `${r.corridor ?? '?'} / ${r.format ?? '?'}`;
    num('lease', id, 'base_rent_php_sqm', r.base_rent_php_sqm, 100, 10_000);
    num('lease', id, 'cusa_php_sqm', r.cusa_php_sqm, 0, 2_000, 'WARN');
    num('lease', id, 'escalation_pct', r.escalation_pct, 0, 20, 'WARN');
    num('lease', id, 'lease_term_years', r.lease_term_years, 1, 30, 'WARN');
    checkTruth('lease', id, r.truth_layer);
    checkSource('lease', id, r.sample_source);
  }
  console.log(`lease: ${rows.length} rows checked`);
} catch (e) { console.log('lease: skipped', (e as Error).message); }

// ---- malls ----
try {
  const rows = asArray(read('malls.ncr.json'));
  for (const r of rows) {
    const id = r.mall_name ?? '?';
    checkCoord('malls', id, r.lat, r.lon, NCR);
    // MOA-class malls legitimately reach ~600k sqm GLA; only flag clearly-impossible values.
    num('malls', id, 'gla_sqm', r.gla_sqm, 1_000, 800_000, 'WARN');
    if (r.tier && !['A', 'B', 'C'].includes(String(r.tier))) warn('malls', id, 'tier', `unexpected tier "${r.tier}"`);
    checkTruth('malls', id, r.truth_layer);
    checkSource('malls', id, r.source);
  }
  console.log(`malls: ${rows.length} rows checked`);
} catch (e) { console.log('malls: skipped', (e as Error).message); }

// ---- zonal (tax-reference floors only) ----
try {
  const rows = asArray(read('zonal.real.json'));
  for (const r of rows) {
    const id = `${r.city_municipality ?? '?'} / ${r.classification_code ?? '?'}`;
    // BGC/Makati prime commercial zonal values legitimately exceed ₱1M/sqm; ceiling is a
    // sanity bound against a units error (e.g. a stray extra zero), not a market cap.
    num('zonal', id, 'low_php_sqm', r.low_php_sqm, 100, 3_000_000, 'WARN');
    num('zonal', id, 'high_php_sqm', r.high_php_sqm, 100, 3_000_000, 'WARN');
    if (r.low_php_sqm != null && r.high_php_sqm != null && Number(r.low_php_sqm) > Number(r.high_php_sqm)) {
      err('zonal', id, 'range', `low (${r.low_php_sqm}) > high (${r.high_php_sqm})`);
    }
  }
  console.log(`zonal: ${rows.length} rows checked`);
} catch (e) { console.log('zonal: skipped', (e as Error).message); }

// ---- franchise requirements matrix ----
try {
  const obj = read('franchiseRequirements.real.json');
  const entries = Object.entries(obj as Record<string, any>);
  for (const [brand, r] of entries) {
    if (!r.vertical) err('franchise', brand, 'vertical', 'missing vertical');
    if (!r.totalInvestment || !/\d/.test(String(r.totalInvestment))) warn('franchise', brand, 'totalInvestment', 'no parseable investment figure');
    if (!r.roiPayback || !/(yr|year|mo|month)/i.test(String(r.roiPayback))) warn('franchise', brand, 'roiPayback', 'no parseable payback');
    checkTruth('franchise', brand, r.truthLayer);
    checkSource('franchise', brand, r.source);
  }
  console.log(`franchise: ${entries.length} brands checked`);
} catch (e) { console.log('franchise: skipped', (e as Error).message); }

// ---- report ----
const wantJson = process.argv.includes('--json');
const errors = issues.filter((i) => i.level === 'ERROR');
const warns = issues.filter((i) => i.level === 'WARN');

if (wantJson) {
  console.log(JSON.stringify({ errors: errors.length, warnings: warns.length, issues }, null, 2));
} else {
  console.log('\n──────── Data Integrity Report ────────');
  const byDatasetLevel: Record<string, number> = {};
  for (const i of issues) byDatasetLevel[`${i.dataset}·${i.level}`] = (byDatasetLevel[`${i.dataset}·${i.level}`] ?? 0) + 1;
  for (const [k, n] of Object.entries(byDatasetLevel).sort()) console.log(`  ${k}: ${n}`);
  console.log('');
  for (const i of issues.slice(0, 60)) {
    console.log(`  [${i.level}] ${i.dataset} · ${i.row} · ${i.field}: ${i.msg}`);
  }
  if (issues.length > 60) console.log(`  … and ${issues.length - 60} more (use --json for all)`);
  console.log(`\n  TOTAL: ${errors.length} errors, ${warns.length} warnings`);
  console.log(errors.length === 0 ? '  ✓ No blocking errors.' : '  ✗ Errors present — fix before ingest.');
}

process.exit(errors.length > 0 ? 1 : 0);
