/**
 * Region registry — the single source of truth for which geographies BSA supports and
 * everything that varies by region: bounding boxes, OSM/Overpass area names, warm-grid
 * centres, lease corridors and city-name canonicalisation.
 *
 * Adding a province becomes CONFIGURATION + DATA (a new entry here + its reference data),
 * not code changes scattered across ingest scripts and resolvers. Pure + client-safe (no
 * server imports) so the resolvers can be unit-tested and reused on both sides.
 *
 * NCR and Davao reproduce the previous hard-coded behaviour exactly (the corridor/city
 * resolvers are ported faithfully). Cavite and Batangas are registered with their bounds,
 * Overpass areas, warm centres, city canonicalisers and (R-06) lease corridors; their
 * boundary polygons + zonal/demographics land in R-02/R-04/R-05. Comps for the provincial
 * corridors are owner-loaded (prisma/data/lease/README.md) — the names here are the CSV keys.
 */

export type RegionKey = 'ncr' | 'davao' | 'cavite' | 'batangas';

/** [south, west, north, east] in WGS84 degrees. */
export type BBox = [number, number, number, number];

export interface Corridor {
  /** Corridor name as stored in lease_comp.corridor. */
  name: string;
  /** Ordered match tokens (checked most-specific first). */
  tokens: RegExp;
}

export interface CityCanon {
  /** Canonical LGU name as used by the zonal dataset. */
  canonical: string;
  tokens: RegExp;
}

export interface RegionDef {
  key: RegionKey;
  /** Display name. */
  name: string;
  /** PSA region code (for reference / boundary joins in R-02). */
  psaRegion: string;
  /** Province name(s) covered (as they appear in OSM admin_level=4 name / PSGC). */
  provinces: string[];
  /** Bounding box for OSM sweeps and coarse point-tagging (before real polygons land in R-02). */
  bbox: BBox;
  /** OSM area name(s) at admin_level=4 for Overpass `area[...]` queries. */
  overpassAreas: string[];
  /** Busy centres the on-demand cache pre-warms per vertical. */
  warmCentres: Array<{ lat: number; lon: number; label: string }>;
  /** Lease corridors we hold (or will hold) comps for, most-specific first. Empty = none yet. */
  corridors: Corridor[];
  /** LGU canonicalisers, most-specific first (drives zonal lookup + region tagging). */
  cities: CityCanon[];
  /** philippines-json-maps region-level file code (the provdists-region-<code> file). */
  psgcRegionCode?: string;
  /** philippines-json-maps province (adm2) codes to fetch for this region. Empty/undefined =
   *  the auto-downloader has no mapping yet (use the ogr2ogr file path). */
  psgcProvinces?: string[];
  /** Rent-to-land calibration: monthly rent (₱/sqm) per ₱1,000 of commercial-zonal midpoint.
   *  Derived per region from corridors that have BOTH lease comps and CR zonal. Undefined =
   *  NOT yet calibrated for this region → the zonal cross-check / indicative rent is withheld
   *  rather than borrowing another region's band (audit F-08). */
  zonalRentBand?: { low: number; central: number; high: number };
}

const NCR: RegionDef = {
  key: 'ncr',
  name: 'Metro Manila (NCR)',
  psaRegion: 'NCR',
  // Calibrated 2026-08 across the 13 NCR corridors with both comps and CR zonal (~₱10/₱1,000/mo).
  zonalRentBand: { low: 6, central: 10, high: 14 },
  provinces: ['Metro Manila', 'National Capital Region'],
  bbox: [14.35, 120.9, 14.78, 121.15],
  overpassAreas: ['Metro Manila', 'National Capital Region'],
  warmCentres: [
    { lat: 14.5547, lon: 121.0244, label: 'Makati CBD' },
    { lat: 14.5507, lon: 121.0487, label: 'BGC' },
    { lat: 14.5866, lon: 121.0614, label: 'Ortigas' },
    { lat: 14.6349, lon: 121.0388, label: 'QC Cubao' },
    { lat: 14.6091, lon: 120.9899, label: 'Manila España' },
    { lat: 14.5378, lon: 121.0014, label: 'Pasay MOA' },
    { lat: 14.4791, lon: 121.0198, label: 'Alabang' },
    { lat: 14.5794, lon: 121.0359, label: 'Mandaluyong' },
  ],
  // Ordered exactly as the previous inferCorridor NCR block.
  corridors: [
    { name: 'BGC', tokens: /bgc|bonifacio|taguig/ },
    { name: 'Ortigas', tokens: /ortigas|pasig|kapitolyo|capitol|san antonio/ },
    { name: 'Makati CBD', tokens: /makati/ },
    { name: 'San Juan', tokens: /greenhills|san juan|wack|little baguio/ },
    { name: 'Pateros', tokens: /pateros/ },
    { name: 'Pasay Bay Area', tokens: /pasay|moa|mall of asia|bay area/ },
    { name: 'Pasay Bay Area', tokens: /parañaque|paranaque|bf homes|sucat|bicutan|aseana/ },
    { name: 'Quezon City', tokens: /quezon city| qc|^qc|cubao|timog|katipunan|araneta/ },
    { name: 'Alabang', tokens: /alabang|muntinlupa|festival|filinvest/ },
    { name: 'Mandaluyong', tokens: /mandaluyong|boni|shaw/ },
    { name: 'Marikina', tokens: /marikina/ },
    { name: 'Manila', tokens: /manila|divisoria|binondo|espana|españa|ermita|sampaloc/ },
    { name: 'CAMANAVA', tokens: /caloocan|valenzuela|malabon|navotas|camanava/ },
    { name: 'Las Piñas', tokens: /las pinas|las piñas|bacoor|zapote/ },
  ],
  // Ordered exactly as the previous canonicalNcrCity block.
  cities: [
    { canonical: 'Parañaque', tokens: /parañaque|paranaque|\bbf homes\b|sucat|bicutan|aseana/ },
    { canonical: 'Las Piñas', tokens: /las ?pi(ñ|n)as|zapote/ },
    { canonical: 'Quezon City', tokens: /quezon city|\bqc\b|cubao|novaliches|diliman|katipunan|commonwealth|fairview|timog|araneta/ },
    { canonical: 'Makati', tokens: /makati/ },
    { canonical: 'Taguig', tokens: /taguig|\bbgc\b|bonifacio|fort bonifacio|mckinley/ },
    { canonical: 'Pasig', tokens: /pasig|ortigas|kapitolyo|capitol commons/ },
    { canonical: 'Mandaluyong', tokens: /mandaluyong|shaw|\bboni\b/ },
    { canonical: 'Muntinlupa', tokens: /muntinlupa|alabang|filinvest|festival/ },
    { canonical: 'Pasay', tokens: /pasay|\bmoa\b|mall of asia|bay area/ },
    { canonical: 'Marikina', tokens: /marikina/ },
    { canonical: 'Valenzuela', tokens: /valenzuela/ },
    { canonical: 'Malabon', tokens: /malabon/ },
    { canonical: 'Navotas', tokens: /navotas/ },
    { canonical: 'Caloocan', tokens: /caloocan/ },
    { canonical: 'Pateros', tokens: /pateros/ },
    { canonical: 'San Juan', tokens: /san juan/ },
    { canonical: 'Manila', tokens: /manila|binondo|ermita|malate|intramuros|sampaloc|quiapo|sta\.? ?cruz|sta\.? ?mesa|\bpaco\b|pandacan|tondo|santa ana|san andres|divisoria|espa(ñ|n)a/ },
  ],
};

const DAVAO: RegionDef = {
  key: 'davao',
  name: 'Davao Region (XI)',
  psaRegion: 'XI',
  provinces: ['Davao del Sur', 'Davao del Norte', 'Davao Oriental', 'Davao de Oro', 'Davao Occidental'],
  bbox: [6.7, 125.2, 7.55, 126.3],
  overpassAreas: ['Davao Region'],
  warmCentres: [
    { lat: 7.0639, lon: 125.6083, label: 'Davao Downtown' },
    { lat: 7.1, lon: 125.645, label: 'Davao Lanang' },
    { lat: 7.085, lon: 125.613, label: 'Davao Bajada' },
    { lat: 7.06, lon: 125.595, label: 'Davao Matina' },
  ],
  corridors: [
    { name: 'Davao City', tokens: /davao city|lanang|matina|buhangin|bajada|toril|agdao|ecoland|abreeza/ },
    { name: 'Davao Provinces', tokens: /tagum|digos|panabo|samal|igacos|mati/ },
  ],
  cities: [
    { canonical: 'Davao City', tokens: /davao city|lanang|matina|buhangin|bajada|toril|agdao|ecoland|abreeza/ },
    { canonical: 'Tagum', tokens: /tagum/ },
    { canonical: 'Digos', tokens: /digos/ },
    { canonical: 'Panabo', tokens: /panabo/ },
  ],
};

const CAVITE: RegionDef = {
  key: 'cavite',
  name: 'Cavite',
  psaRegion: 'IV-A',
  provinces: ['Cavite'],
  bbox: [14.05, 120.5, 14.55, 121.1],
  overpassAreas: ['Cavite'],
  warmCentres: [
    { lat: 14.4593, lon: 120.9366, label: 'Bacoor' },
    { lat: 14.4297, lon: 120.9367, label: 'Imus' },
    { lat: 14.3294, lon: 120.9367, label: 'Dasmariñas' },
    { lat: 14.3869, lon: 120.8817, label: 'General Trias' },
    { lat: 14.1153, lon: 120.9621, label: 'Tagaytay' },
  ],
  // R-06: provincial lease corridors. The names below are what the owner uses in the
  // lease CSV (see prisma/data/lease/README.md); comps stay empty until that CSV loads,
  // so resolveCorridorForSite still falls back to a default until real comps exist.
  corridors: [
    { name: 'Bacoor–Imus', tokens: /bacoor|molino|\bimus\b|kawit|noveleta/ },
    { name: 'Dasmariñas–General Trias', tokens: /dasmari(ñ|n)as|dasma\b|general trias|gen\.? ?trias|gentri|trece|rosario, ?cavite|\btanza\b|cavite city/ },
    { name: 'Tagaytay–Silang', tokens: /tagaytay|\bsilang\b/ },
  ],
  psgcRegionCode: '400000000', // CALABARZON (Region IV-A)
  psgcProvinces: ['402100000'], // Cavite
  cities: [
    { canonical: 'Bacoor', tokens: /bacoor|molino|zapote/ },
    { canonical: 'Imus', tokens: /\bimus\b/ },
    { canonical: 'Dasmariñas', tokens: /dasmari(ñ|n)as|dasma\b/ },
    { canonical: 'General Trias', tokens: /general trias|gen\.? trias|gentri/ },
    { canonical: 'Kawit', tokens: /\bkawit\b/ },
    { canonical: 'Noveleta', tokens: /noveleta/ },
    { canonical: 'Rosario', tokens: /rosario, ?cavite|rosario cavite/ },
    { canonical: 'Tanza', tokens: /\btanza\b/ },
    { canonical: 'Trece Martires', tokens: /trece martires|trece/ },
    { canonical: 'Tagaytay', tokens: /tagaytay/ },
    { canonical: 'Silang', tokens: /\bsilang\b/ },
    { canonical: 'Cavite City', tokens: /cavite city/ },
  ],
};

const BATANGAS: RegionDef = {
  key: 'batangas',
  name: 'Batangas',
  psaRegion: 'IV-A',
  provinces: ['Batangas'],
  bbox: [13.5, 120.55, 14.2, 121.55],
  overpassAreas: ['Batangas'],
  warmCentres: [
    { lat: 13.7565, lon: 121.0583, label: 'Batangas City' },
    { lat: 13.9411, lon: 121.1622, label: 'Lipa' },
    { lat: 14.1079, lon: 121.1416, label: 'Sto. Tomas' },
    { lat: 14.0863, lon: 121.1497, label: 'Tanauan' },
  ],
  // R-06: provincial lease corridors (names used in the lease CSV; comps empty until loaded).
  corridors: [
    { name: 'Sto. Tomas–Tanauan', tokens: /sto\.? ?tomas|santo tomas|tanauan|\bmalvar\b/ },
    { name: 'Lipa', tokens: /\blipa\b/ },
    { name: 'Batangas City', tokens: /batangas city|\bbauan\b/ },
  ],
  psgcRegionCode: '400000000', // CALABARZON (Region IV-A)
  psgcProvinces: ['401000000'], // Batangas
  cities: [
    { canonical: 'Batangas City', tokens: /batangas city/ },
    { canonical: 'Lipa', tokens: /\blipa\b/ },
    { canonical: 'Sto. Tomas', tokens: /sto\.? ?tomas|santo tomas/ },
    { canonical: 'Tanauan', tokens: /tanauan/ },
    { canonical: 'Nasugbu', tokens: /nasugbu/ },
    { canonical: 'Lemery', tokens: /lemery/ },
    { canonical: 'Bauan', tokens: /\bbauan\b/ },
    { canonical: 'San Juan', tokens: /san juan, ?batangas|san juan batangas/ },
  ],
};

const REGISTRY: Record<RegionKey, RegionDef> = { ncr: NCR, davao: DAVAO, cavite: CAVITE, batangas: BATANGAS };

/** Priority order for coarse bbox point-tagging: tighter/urban boxes before the large Davao box. */
const POINT_ORDER: RegionKey[] = ['ncr', 'cavite', 'batangas', 'davao'];

export const REGION_KEYS = Object.keys(REGISTRY) as RegionKey[];

export function getRegion(key: string | null | undefined): RegionDef | null {
  return key && (key in REGISTRY) ? REGISTRY[key as RegionKey] : null;
}

export function listRegions(): RegionDef[] {
  return REGION_KEYS.map((k) => REGISTRY[k]);
}

function inBBox(lat: number, lon: number, b: BBox): boolean {
  return lat >= b[0] && lat <= b[2] && lon >= b[1] && lon <= b[3];
}

/**
 * Coarse region for a coordinate by bounding box. Approximate near province borders (NCR/Cavite
 * overlap around Bacoor/Las Piñas); prefer `regionForSite` which uses the LGU name first, and
 * R-02's real polygons once loaded. Returns null outside every supported box.
 */
export function regionForPoint(lat: number | null | undefined, lon: number | null | undefined): RegionKey | null {
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  for (const k of POINT_ORDER) {
    if (inBBox(lat, lon, REGISTRY[k].bbox)) return k;
  }
  return null;
}

/** Canonical LGU + its region from a city/label string. Checks all regions, most-specific first. */
export function canonicalCity(city: string | null | undefined, label?: string | null): { region: RegionKey; city: string } | null {
  const hay = `${city ?? ''} ${label ?? ''}`.toLowerCase();
  if (!hay.trim()) return null;
  // NCR first (densest, most specific tokens), then the rest — mirrors the previous ordering.
  for (const k of ['ncr', 'cavite', 'batangas', 'davao'] as RegionKey[]) {
    for (const c of REGISTRY[k].cities) {
      if (c.tokens.test(hay)) return { region: k, city: c.canonical };
    }
  }
  return null;
}

/**
 * Best region for a site: the LGU name wins (reliable, user-picked), then the pinned coordinate,
 * then null (unsupported/unknown). This is what tags candidate_site.region.
 */
export function regionForSite(site: { city?: string | null; label?: string | null; lat?: number | null; lon?: number | null }): RegionKey | null {
  return canonicalCity(site.city, site.label)?.region ?? regionForPoint(site.lat ?? null, site.lon ?? null);
}

/**
 * Infer the lease corridor for a site. Region-first (R-06): the site's own region (resolved by
 * LGU name) is scanned before the others, so a Cavite/Batangas site hits its provincial corridor
 * instead of a border NCR corridor (e.g. Bacoor → 'Bacoor–Imus', not NCR 'Las Piñas'). NCR/Davao
 * sites are unaffected — their region is scanned first exactly as before. Returns null when
 * nothing matches; callers fall back to a default corridor that has comps.
 */
export function inferCorridor(city: string | null | undefined, label: string | null | undefined): string | null {
  const hay = `${city ?? ''} ${label ?? ''}`.toLowerCase();
  // Put the site's own region first (if identifiable), then the historical order for the rest.
  const own = canonicalCity(city, label)?.region ?? null;
  const base: RegionKey[] = ['ncr', 'cavite', 'batangas', 'davao'];
  const order = own ? [own, ...base.filter((k) => k !== own)] : base;
  for (const k of order) {
    for (const corr of REGISTRY[k].corridors) {
      if (corr.tokens.test(hay)) return corr.name;
    }
  }
  return null;
}

/** All corridor names known for a region (for a corridor picker — U-02). */
export function corridorsForRegion(key: string | null | undefined): string[] {
  const r = getRegion(key);
  return r ? Array.from(new Set(r.corridors.map((c) => c.name))) : [];
}
