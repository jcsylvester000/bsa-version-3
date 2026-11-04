/**
 * Census labelling helpers (Brief alignment T-1 / T-4). Pure — unit-tested.
 */

/** Plain-words source for a census population figure. */
export function censusSourceLabel(year: number | null | undefined): string {
  if (year === 2024) return 'PSA 2024 Census (POPCEN)';
  if (year === 2020) return 'PSA 2020 Census (CPH)';
  if (year != null) return `PSA ${year} Census`;
  return 'PSA Census';
}

/** The Truth Layer of a summed population: the weakest per-field label among the cells used
 *  (legacy rows fall back to their row label). No cells → null. */
export function populationTruthOf(labels: Array<string | null | undefined>): 'verified' | 'assumed' | 'projected' | null {
  const ls = labels.filter((l): l is string => !!l);
  if (!ls.length) return null;
  if (ls.includes('projected')) return 'projected';
  if (ls.includes('assumed')) return 'assumed';
  return 'verified';
}
