/**
 * Pure mapping from a census/HDX CSV record to a demographic_cell row. Tolerant of the column
 * names PSA/HDX exports use (ADM4_PCODE / adm4_psgc / PSGC; T_TL / population / pop_2020 …).
 * No I/O — unit-tested in tests/unit/demographicsRow.test.ts.
 */

export interface DemoRow {
  psgcCode: string;
  barangay: string | null;
  city: string | null;
  population: number | null;
  incomeBand: string | null;
  daytimePop: number | null;
}

const KEYS = {
  psgc: ['adm4_psgc', 'ADM4_PCODE', 'ADM4_PSGC', 'bgy_psgc', 'brgy_psgc', 'psgc', 'PSGC', 'geocode', 'PCODE', 'pcode'],
  name: ['adm4_en', 'ADM4_EN', 'barangay', 'Barangay', 'BARANGAY', 'bgy_name', 'name', 'NAME'],
  city: ['adm3_en', 'ADM3_EN', 'city', 'City', 'municipality', 'Municipality', 'MunicipalityCity'],
  population: ['population', 'Population', 'POPULATION', 'pop_2020', 'pop2020', 'population_2020', 'total_population', 'T_TL', 'F_TOT_POP', 'total', 'pop'],
  income: ['income_band', 'incomeBand', 'income_class', 'income'],
  daytime: ['daytime_pop', 'daytimePop', 'daytime_population'],
};

function pick(rec: Record<string, unknown>, candidates: string[]): string | null {
  for (const k of candidates) {
    const v = rec[k];
    if (v != null && `${v}`.trim() !== '') return `${v}`.trim();
  }
  return null;
}

function numOrNull(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

/** PSGC → digits only (preserve leading zeros as text). */
export function normalizePsgc(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const d = `${raw}`.replace(/[^0-9]/g, '');
  return d.length ? d : null;
}

/** Map one CSV record to a DemoRow, or null when it has no PSGC code. */
export function demographicsRowFrom(rec: Record<string, unknown>): DemoRow | null {
  const psgcCode = normalizePsgc(pick(rec, KEYS.psgc));
  if (!psgcCode) return null;
  return {
    psgcCode,
    barangay: pick(rec, KEYS.name),
    city: pick(rec, KEYS.city),
    population: numOrNull(pick(rec, KEYS.population)),
    incomeBand: pick(rec, KEYS.income),
    daytimePop: numOrNull(pick(rec, KEYS.daytime)),
  };
}
