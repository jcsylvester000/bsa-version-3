/**
 * Pure mapping from a census/HDX CSV record to a demographic_cell row. Tolerant of the column
 * names PSA/HDX exports use (ADM4_PCODE / adm4_psgc / PSGC; T_TL / population / pop_2020 …).
 * No I/O — unit-tested in tests/unit/demographicsRow.test.ts.
 */
import { psgc10 } from './psgcCode';

export interface DemoRow {
  psgcCode: string;
  barangay: string | null;
  city: string | null;
  population: number | null;
  incomeBand: string | null;
  daytimePop: number | null;
  /** Census year read from the population column name (pop_2020 → 2020), else null. */
  censusYear: number | null;
}

const KEYS = {
  psgc: ['adm4_psgc', 'ADM4_PCODE', 'ADM4_PSGC', 'bgy_psgc', 'brgy_psgc', 'psgc', 'PSGC', 'geocode', 'PCODE', 'pcode'],
  name: ['adm4_en', 'ADM4_EN', 'barangay', 'Barangay', 'BARANGAY', 'bgy_name', 'name', 'NAME'],
  city: ['adm3_en', 'ADM3_EN', 'city', 'City', 'municipality', 'Municipality', 'MunicipalityCity'],
  population: ['population', 'Population', 'POPULATION', 'pop_2024', 'pop2024', 'population_2024', 'pop_2020', 'pop2020', 'population_2020', 'total_population', 'T_TL', 'F_TOT_POP', 'total', 'pop'],
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

/** The census year implied by the first population column present (pop_2024 → 2024). */
export function censusYearFrom(rec: Record<string, unknown>): number | null {
  for (const k of KEYS.population) {
    const v = rec[k];
    if (v == null || `${v}`.trim() === '') continue;
    const m = /(20[12][0-9])/.exec(k);
    return m ? Number(m[1]) : null;
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
  return psgc10(raw);
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
    censusYear: censusYearFrom(rec),
  };
}
