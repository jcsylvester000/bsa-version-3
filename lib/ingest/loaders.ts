/**
 * Reference-data loaders — idempotent ETL into the reference tables.
 *
 * Discipline (Database Engineer): validate before writing, classify Truth Layer at
 * the data layer, never fabricate a row, upsert on the natural key so re-runs are
 * safe. geom for POI is computed by DB trigger from lat/lon; demographics store a
 * point geom built here (polygon boundaries are a later ingestion enhancement).
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import {
  normalizePoi, poiDedupKey, type RawPoi,
  normalizeZonal, zonalNaturalKey, type RawZonal,
  normalizeDemo, type RawDemo,
  normalizeLease, leaseNaturalKey, type RawLease,
} from './normalize';
import { Prisma, type PoiCategory } from '@prisma/client';

export interface LoadReport {
  received: number;
  loaded: number;
  skipped: number;
  deduped: number;
}

/** Load POI rows (OSM Overpass shape). Dedup in-batch, upsert on osm_id. */
export async function loadPoi(rows: RawPoi[]): Promise<LoadReport> {
  const seen = new Set<string>();
  let skipped = 0;
  let deduped = 0;
  const norm = [];
  for (const r of rows) {
    const n = normalizePoi(r);
    if (!n) { skipped++; continue; }
    const key = poiDedupKey(n);
    if (seen.has(key)) { deduped++; continue; }
    seen.add(key);
    norm.push(n);
  }
  let loaded = 0;
  for (const n of norm) {
    // osm_id is nullable, so Prisma won't accept it as a unique upsert selector.
    // Find-then-write keeps ingestion idempotent on re-runs.
    const data = {
      name: n.name,
      category: n.category as PoiCategory,
      lat: n.lat,
      lon: n.lon,
      city: n.city,
      barangay: n.barangay,
      truthLayer: n.truthLayer,
    };
    if (n.osmId != null) {
      const existing = await prisma.poi.findFirst({ where: { osmId: n.osmId }, select: { id: true } });
      if (existing) {
        await prisma.poi.update({ where: { id: existing.id }, data });
      } else {
        await prisma.poi.create({ data: { ...data, osmId: n.osmId, source: 'osm' } });
      }
    } else {
      await prisma.poi.create({ data: { ...data, source: 'manual' } });
    }
    loaded++;
  }
  return { received: rows.length, loaded, skipped, deduped };
}

/** Load BIR zonal rows. Upsert on the natural key. */
export async function loadZonal(rows: RawZonal[]): Promise<LoadReport> {
  const seen = new Set<string>();
  let skipped = 0;
  let deduped = 0;
  let loaded = 0;
  for (const r of rows) {
    const n = normalizeZonal(r);
    if (!n) { skipped++; continue; }
    const key = zonalNaturalKey(n);
    if (seen.has(key)) { deduped++; continue; }
    seen.add(key);
    await prisma.zonalValue.upsert({
      where: { zonal_natural_key: { region: n.region, cityMunicipality: n.cityMunicipality, rdo: n.rdo ?? '', classificationCode: n.classificationCode } },
      update: { province: n.province, lowPhpSqm: n.lowPhpSqm, highPhpSqm: n.highPhpSqm, truthLayer: n.truthLayer, notes: n.notes },
      create: { region: n.region, province: n.province, cityMunicipality: n.cityMunicipality, rdo: n.rdo ?? '', classificationCode: n.classificationCode, lowPhpSqm: n.lowPhpSqm, highPhpSqm: n.highPhpSqm, truthLayer: n.truthLayer, notes: n.notes },
    });
    loaded++;
  }
  return { received: rows.length, loaded, skipped, deduped };
}

/**
 * Load lease comps. lease_comp has no unique natural key, so we clear each
 * (format, corridor) group present in the batch then insert — idempotent per group.
 */
export async function loadLease(rows: RawLease[]): Promise<LoadReport> {
  const seen = new Set<string>();
  let skipped = 0;
  let deduped = 0;
  const norm: ReturnType<typeof normalizeLease>[] = [];
  for (const r of rows) {
    const n = normalizeLease(r);
    if (!n) { skipped++; continue; }
    const key = leaseNaturalKey(n);
    if (seen.has(key)) { deduped++; continue; }
    seen.add(key);
    norm.push(n);
  }
  // Clear the (format, corridor) groups this batch touches, then insert fresh.
  const groups = new Map<string, { format: string; corridor: string }>();
  for (const n of norm) if (n) groups.set(`${n.format}|${n.corridor}`, { format: n.format, corridor: n.corridor });
  for (const g of groups.values()) {
    await prisma.leaseComp.deleteMany({ where: { format: g.format, corridor: g.corridor } });
  }
  let loaded = 0;
  for (const n of norm) {
    if (!n) continue;
    await prisma.leaseComp.create({
      data: {
        format: n.format,
        corridor: n.corridor,
        mallName: n.mallName,
        baseRentPhpSqm: n.baseRentPhpSqm != null ? new Prisma.Decimal(n.baseRentPhpSqm) : null,
        escalationPct: n.escalationPct != null ? new Prisma.Decimal(n.escalationPct) : null,
        cusaPhpSqm: n.cusaPhpSqm != null ? new Prisma.Decimal(n.cusaPhpSqm) : null,
        leaseTermYears: n.leaseTermYears,
        fitoutMonths: n.fitoutMonths,
        observedDate: n.observedDate ? new Date(n.observedDate) : null,
        truthLayer: n.truthLayer,
        sampleSource: n.sampleSource,
      },
    });
    loaded++;
  }
  return { received: rows.length, loaded, skipped, deduped };
}

/** Raw NCR mall roster row (malls.ncr.json shape). */
export interface RawMall {
  mall_name?: string | null;
  city?: string | null;
  tier?: string | null;
  footfall_band?: string | null;
  rent_band_php_sqm?: string | null;
  cusa_band?: string | null;
  lat?: number | null;
  lon?: number | null;
  truth_layer?: string | null;
}

const MALL_TIERS = new Set(['A', 'B', 'C']);
const FOOTFALL_BANDS = new Set(['very_high', 'high', 'medium', 'low']);
const TRUTH_LAYERS = new Set(['verified', 'assumed', 'projected']);

/** Load NCR mall roster. Upsert on mall_name; geom from lat/lon via raw SQL. Rows with an
 *  invalid tier/footfall are skipped (never fabricated to a default). */
export async function loadMalls(rows: RawMall[]): Promise<LoadReport> {
  const seen = new Set<string>();
  let skipped = 0;
  let deduped = 0;
  let loaded = 0;
  for (const r of rows) {
    const name = (r.mall_name ?? '').trim();
    const tier = String(r.tier);
    const ff = String(r.footfall_band);
    if (!name || !MALL_TIERS.has(tier) || !FOOTFALL_BANDS.has(ff)) { skipped++; continue; }
    if (seen.has(name.toLowerCase())) { deduped++; continue; }
    seen.add(name.toLowerCase());
    const tl = TRUTH_LAYERS.has(String(r.truth_layer)) ? String(r.truth_layer) : 'assumed';
    const data = {
      mallName: name,
      city: r.city?.trim() || null,
      tier: tier as 'A' | 'B' | 'C',
      footfallBand: ff as 'very_high' | 'high' | 'medium' | 'low',
      rentBandPhpSqm: r.rent_band_php_sqm?.trim() || null,
      cusaBand: r.cusa_band?.trim() || null,
      lat: r.lat ?? null,
      lon: r.lon ?? null,
      truthLayer: tl as 'verified' | 'assumed' | 'projected',
    };
    const existing = await prisma.mallProperty.findFirst({ where: { mallName: name }, select: { id: true } });
    const row = existing
      ? await prisma.mallProperty.update({ where: { id: existing.id }, data })
      : await prisma.mallProperty.create({ data });
    // Populate geom from lat/lon (no DB trigger on mall_property).
    if (data.lat != null && data.lon != null) {
      await prisma.$executeRaw`UPDATE mall_property SET geom = ST_SetSRID(ST_MakePoint(${data.lon}, ${data.lat}), 4326)::geography WHERE id = ${row.id}`;
    }
    loaded++;
  }
  return { received: rows.length, loaded, skipped, deduped };
}

/** Load PSA demographic rows. Upsert on psgc_code; store a point geom via raw SQL. */
export async function loadDemographics(rows: Array<RawDemo & { lat?: number; lon?: number }>): Promise<LoadReport> {
  const seen = new Set<string>();
  let skipped = 0;
  let deduped = 0;
  let loaded = 0;
  for (const r of rows) {
    const n = normalizeDemo(r);
    if (!n) { skipped++; continue; }
    if (seen.has(n.psgcCode)) { deduped++; continue; }
    seen.add(n.psgcCode);
    // find-then-write (like the POI loader) so this is idempotent regardless of how
    // Prisma exposes the psgc_code unique selector — avoids the WhereUnique quirk.
    const data = {
      barangay: n.barangay, city: n.city, population: n.population,
      incomeBand: n.incomeBand, renterSharePct: n.renterSharePct,
      daytimePop: n.daytimePop, truthLayer: n.truthLayer,
    };
    const existing = await prisma.demographicCell.findFirst({ where: { psgcCode: n.psgcCode }, select: { id: true } });
    if (existing) {
      await prisma.demographicCell.update({ where: { id: existing.id }, data });
    } else {
      await prisma.demographicCell.create({ data: { psgcCode: n.psgcCode, ...data } });
    }
    // Set a small circular polygon geom around the cell centroid so containment/
    // proximity joins work. (Real PSGC boundary polygons replace this later.)
    if (r.lat != null && r.lon != null) {
      await prisma.$executeRaw`
        UPDATE demographic_cell
        SET geom = ST_Buffer(ST_SetSRID(ST_MakePoint(${r.lon}, ${r.lat}), 4326)::geography, 600)::geography
        WHERE psgc_code = ${n.psgcCode}
      `;
    }
    loaded++;
  }
  return { received: rows.length, loaded, skipped, deduped };
}
