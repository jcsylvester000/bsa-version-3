/**
 * Reference-data loaders — idempotent ETL into the reference tables.
 *
 * Discipline (Database Engineer): validate before writing, classify Truth Layer at
 * the data layer, never fabricate a row, upsert on the natural key so re-runs are
 * safe. geom for POI is computed by DB trigger from lat/lon; demographics store a
 * point geom built here (polygon boundaries are a later ingestion enhancement).
 */
import 'server-only';
import { prisma as appPrisma } from '@/lib/db/prisma';
import {
  normalizePoi, poiDedupKey, type RawPoi,
  normalizeZonal, zonalNaturalKey, type RawZonal,
  normalizeDemo, type RawDemo,
  normalizeLease, leaseNaturalKey, type RawLease,
} from './normalize';
import { Prisma, PrismaClient } from '@prisma/client';

export interface LoadReport {
  received: number;
  loaded: number;
  skipped: number;
  deduped: number;
}

/**
 * F-22: loaders accept a `db` client. Bulk scripts pass the DIRECT pooled client (see
 * prisma/scriptDb.ts) so province-scale writes go out as chunked multi-row statements over a warm
 * TCP connection instead of one HTTP round trip per row. Defaults to the app client.
 */
type Db = Pick<PrismaClient, '$executeRaw' | 'poi' | 'zonalValue' | 'demographicCell' | 'leaseComp' | 'mallProperty'>;
interface LoadOpts { db?: Db; source?: 'osm' | 'google' | 'manual'; provenance?: string }

/** Rows-per statement for the batched upserts. ~500 keeps each statement well under Postgres'
 *  parameter limit (65535) even for the widest table, and is a good round-trip/latency trade. */
const BATCH_SIZE = 500;
function chunk<T>(arr: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Load POI rows (OSM Overpass shape). Dedup in-batch, upsert on osm_id.
 * F-18: `opts.source` / `opts.provenance` record where the rows came from. The default is the
 * OSM sweep; a row that carries no osmId AND no explicit source is treated as hand-loaded ('manual').
 */
export async function loadPoi(rows: RawPoi[], opts: LoadOpts = {}): Promise<LoadReport> {
  const db = opts.db ?? appPrisma;
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

  // Rows WITH an osm_id upsert on the (unique) osm_id in one multi-row statement per chunk (F-22).
  // Rows WITHOUT one (rare — sample/manual data) can't be deduped by the DB, so they're inserted.
  // geom is filled by the poi_geom_biu trigger on INSERT/UPDATE — no extra round trip.
  const withId = norm.filter((n) => n!.osmId != null);
  const noId = norm.filter((n) => n!.osmId == null);
  let loaded = 0;

  const src = (n: NonNullable<ReturnType<typeof normalizePoi>>) => opts.source ?? (n.osmId != null ? 'osm' : 'manual');
  const prov = (source: string) => opts.provenance ?? (source === 'osm' ? 'osm:overpass' : null);
  const valuesRow = (n: NonNullable<ReturnType<typeof normalizePoi>>) => {
    const source = src(n);
    return Prisma.sql`(${n.name}, ${n.category}::"PoiCategory", ${n.lat}, ${n.lon}, ${n.city}, ${n.barangay}, ${n.region}, ${n.province}, ${source}::"PoiSource", ${prov(source)}, ${n.truthLayer}::"TruthLayer", ${n.osmId})`;
  };

  for (const batch of chunk(withId)) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO poi (name, category, lat, lon, city, barangay, region, province, source, provenance, truth_layer, osm_id)
      VALUES ${Prisma.join(batch.map((n) => valuesRow(n!)))}
      ON CONFLICT (osm_id) DO UPDATE SET
        name = EXCLUDED.name, category = EXCLUDED.category, lat = EXCLUDED.lat, lon = EXCLUDED.lon,
        city = EXCLUDED.city, barangay = EXCLUDED.barangay, region = EXCLUDED.region,
        province = EXCLUDED.province, source = EXCLUDED.source, provenance = EXCLUDED.provenance,
        truth_layer = EXCLUDED.truth_layer`);
    loaded += batch.length;
  }
  for (const batch of chunk(noId)) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO poi (name, category, lat, lon, city, barangay, region, province, source, provenance, truth_layer, osm_id)
      VALUES ${Prisma.join(batch.map((n) => valuesRow(n!)))}`);
    loaded += batch.length;
  }
  return { received: rows.length, loaded, skipped, deduped };
}

/** Load BIR zonal rows. Upsert on the natural key. */
export async function loadZonal(rows: RawZonal[], opts: LoadOpts = {}): Promise<LoadReport> {
  const db = opts.db ?? appPrisma;
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
    await db.zonalValue.upsert({
      where: { zonal_natural_key: { region: n.region, cityMunicipality: n.cityMunicipality, barangay: n.barangay, rdo: n.rdo, classificationCode: n.classificationCode } },
      update: { province: n.province, lowPhpSqm: n.lowPhpSqm, highPhpSqm: n.highPhpSqm, truthLayer: n.truthLayer, notes: n.notes },
      create: { region: n.region, province: n.province, cityMunicipality: n.cityMunicipality, barangay: n.barangay, rdo: n.rdo, classificationCode: n.classificationCode, lowPhpSqm: n.lowPhpSqm, highPhpSqm: n.highPhpSqm, truthLayer: n.truthLayer, notes: n.notes },
    });
    loaded++;
  }
  return { received: rows.length, loaded, skipped, deduped };
}

/**
 * Load lease comps. lease_comp has no unique natural key, so we clear each
 * (format, corridor) group present in the batch then insert — idempotent per group.
 */
export async function loadLease(rows: RawLease[], opts: LoadOpts = {}): Promise<LoadReport> {
  const db = opts.db ?? appPrisma;
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
    await db.leaseComp.deleteMany({ where: { format: g.format, corridor: g.corridor } });
  }
  let loaded = 0;
  for (const n of norm) {
    if (!n) continue;
    await db.leaseComp.create({
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

/** Raw mall roster row (malls.ncr.json shape; region/province optional — R-07). */
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
  region?: string | null;
  province?: string | null;
}

const MALL_TIERS = new Set(['A', 'B', 'C']);
const FOOTFALL_BANDS = new Set(['very_high', 'high', 'medium', 'low']);
const TRUTH_LAYERS = new Set(['verified', 'assumed', 'projected']);

/** Load NCR mall roster. Upsert on mall_name; geom from lat/lon via raw SQL. Rows with an
 *  invalid tier/footfall are skipped (never fabricated to a default). */
export async function loadMalls(rows: RawMall[], opts: LoadOpts = {}): Promise<LoadReport> {
  const db = opts.db ?? appPrisma;
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
      region: r.region?.trim() || null,
      province: r.province?.trim() || null,
      truthLayer: tl as 'verified' | 'assumed' | 'projected',
    };
    const existing = await db.mallProperty.findFirst({ where: { mallName: name }, select: { id: true } });
    const row = existing
      ? await db.mallProperty.update({ where: { id: existing.id }, data })
      : await db.mallProperty.create({ data });
    // Populate geom from lat/lon (no DB trigger on mall_property).
    if (data.lat != null && data.lon != null) {
      await db.$executeRaw`UPDATE mall_property SET geom = ST_SetSRID(ST_MakePoint(${data.lon}, ${data.lat}), 4326)::geography WHERE id = ${row.id}`;
    }
    loaded++;
  }
  return { received: rows.length, loaded, skipped, deduped };
}

/**
 * Load PSA demographic rows. Upsert on psgc_code (F-22: chunked multi-row statement per batch).
 * geom (a ~600 m MultiPolygon buffer around the centroid — a placeholder until real R-02/R-04
 * barangay polygons replace it) is folded into the INSERT so there's no extra round trip per row.
 */
export async function loadDemographics(
  rows: Array<RawDemo & { lat?: number; lon?: number }>,
  opts: LoadOpts = {},
): Promise<LoadReport> {
  const db = opts.db ?? appPrisma;
  const seen = new Set<string>();
  let skipped = 0;
  let deduped = 0;
  const norm: Array<{ n: NonNullable<ReturnType<typeof normalizeDemo>>; lat?: number; lon?: number }> = [];
  for (const r of rows) {
    const n = normalizeDemo(r);
    if (!n) { skipped++; continue; }
    if (seen.has(n.psgcCode)) { deduped++; continue; }
    seen.add(n.psgcCode);
    norm.push({ n, lat: r.lat, lon: r.lon });
  }

  let loaded = 0;
  const valuesRow = ({ n, lat, lon }: { n: NonNullable<ReturnType<typeof normalizeDemo>>; lat?: number; lon?: number }) => {
    // ST_Multi to match the MultiPolygon column (R-04 widened it from Polygon).
    const geom = lat != null && lon != null
      ? Prisma.sql`ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography, 600)::geometry)::geography`
      : Prisma.sql`NULL`;
    return Prisma.sql`(${n.psgcCode}, ${n.barangay}, ${n.city}, ${n.population}, ${n.incomeBand}, ${n.renterSharePct}, ${n.daytimePop}, ${n.truthLayer}::"TruthLayer", ${geom})`;
  };

  for (const batch of chunk(norm)) {
    await db.$executeRaw(Prisma.sql`
      INSERT INTO demographic_cell (psgc_code, barangay, city, population, income_band, renter_share_pct, daytime_pop, truth_layer, geom)
      VALUES ${Prisma.join(batch.map(valuesRow))}
      ON CONFLICT (psgc_code) DO UPDATE SET
        barangay = EXCLUDED.barangay, city = EXCLUDED.city, population = EXCLUDED.population,
        income_band = EXCLUDED.income_band, renter_share_pct = EXCLUDED.renter_share_pct,
        daytime_pop = EXCLUDED.daytime_pop, truth_layer = EXCLUDED.truth_layer, geom = EXCLUDED.geom`);
    loaded += batch.length;
  }
  return { received: rows.length, loaded, skipped, deduped };
}
