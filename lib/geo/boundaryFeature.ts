/**
 * Pure mapping from a PSGC/GeoJSON boundary feature's properties to an admin_boundary row.
 *
 * PSA/OCHA shapefiles use different attribute names across releases (adm4_psgc vs ADM4_PCODE
 * vs Bgy_PSGC …). This resolver tries a set of candidate keys per level so the loader works
 * across the common exports, and the owner can extend the lists if their file differs.
 * No I/O — unit-tested in tests/unit/boundaryFeature.test.ts.
 */

export type BoundaryLevel = 'region' | 'province' | 'city' | 'barangay';

export interface BoundaryRow {
  psgcCode: string;
  level: BoundaryLevel;
  name: string;
  parentPsgc: string | null;
}

/** Candidate property keys per level (code, name, parent), most-specific export first. */
const KEYS: Record<BoundaryLevel, { code: string[]; name: string[]; parent: string[] }> = {
  region: {
    code: ['adm1_psgc', 'ADM1_PCODE', 'reg_psgc', 'psgc', 'PSGC', 'geocode'],
    name: ['adm1_en', 'ADM1_EN', 'REGION', 'Region', 'name', 'NAME'],
    parent: [],
  },
  province: {
    code: ['adm2_psgc', 'ADM2_PCODE', 'prov_psgc', 'psgc', 'PSGC', 'geocode'],
    name: ['adm2_en', 'ADM2_EN', 'PROVINCE', 'Province', 'name', 'NAME'],
    parent: ['adm1_psgc', 'ADM1_PCODE', 'reg_psgc'],
  },
  city: {
    code: ['adm3_psgc', 'ADM3_PCODE', 'mun_psgc', 'city_psgc', 'psgc', 'PSGC', 'geocode'],
    name: ['adm3_en', 'ADM3_EN', 'MUNICIPALITY', 'MunicipalityCity', 'City', 'name', 'NAME'],
    parent: ['adm2_psgc', 'ADM2_PCODE', 'prov_psgc'],
  },
  barangay: {
    code: ['adm4_psgc', 'ADM4_PCODE', 'bgy_psgc', 'brgy_psgc', 'psgc', 'PSGC', 'geocode'],
    name: ['adm4_en', 'ADM4_EN', 'BARANGAY', 'Bgy_Name', 'Barangay', 'name', 'NAME'],
    parent: ['adm3_psgc', 'ADM3_PCODE', 'mun_psgc', 'city_psgc'],
  },
};

type Props = Record<string, unknown>;

/** First present, non-empty candidate value as a trimmed string. */
function pick(props: Props, candidates: string[]): string | null {
  for (const k of candidates) {
    const v = props[k];
    if (v != null && `${v}`.trim() !== '') return `${v}`.trim();
  }
  return null;
}

/** Normalise a PSGC code: keep digits, preserve leading zeros as text; drop stray separators. */
export function normalizePsgc(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const digits = `${raw}`.replace(/[^0-9]/g, '');
  return digits.length ? digits : null;
}

/**
 * Map one feature's properties to a boundary row for `level`, or null when no code/name is found
 * (the loader logs and skips those, and prints the keys it saw so mappings can be extended).
 */
export function boundaryFeatureToRow(props: Props, level: BoundaryLevel): BoundaryRow | null {
  const cfg = KEYS[level];
  const psgcCode = normalizePsgc(pick(props, cfg.code));
  const name = pick(props, cfg.name);
  if (!psgcCode || !name) return null;
  return {
    psgcCode,
    level,
    name,
    parentPsgc: cfg.parent.length ? normalizePsgc(pick(props, cfg.parent)) : null,
  };
}
