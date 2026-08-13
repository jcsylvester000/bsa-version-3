/**
 * Vertical-aware module activation — pure config, no server imports.
 *
 * The intake asks the format first, then only the modules that matter for it run
 * (architecture: "a fuel station never gets scored on mall footfall; a cafe never
 * gets a lot-geometry screen"). This keeps each report honest about what it measured.
 *
 * Every vertical always runs the core modules (site_fit, territory, financial/lease
 * where data exists); the extras below are the vertical-specific ones.
 */
import type { ModuleKind, Vertical } from '@prisma/client';

/**
 * Modules that run for EVERY vertical, so every intake always produces a result for the
 * four headline intelligence reads: Territory Guard, Lease Benchmark, Daypart Demand, and
 * White-Space. (site_fit is the composite base.) A module that runs outside its ideal
 * format still returns a real, honest result — the UI marks it "contextual / lower weight"
 * via isPrimaryModule() so a weak-context read never masquerades as a strong one. This
 * keeps the Truth Layer discipline while guaranteeing all four tabs are always populated.
 */
export const CORE_MODULES: ModuleKind[] = ['site_fit', 'territory', 'lease', 'daypart', 'whitespace'];

/**
 * The verticals for which each "always-on but format-sensitive" module is a PRIMARY
 * (decision-grade) read rather than a contextual one. Territory and Lease are primary for
 * every format (cannibalization and rent apply universally). Daypart and White-Space are
 * primary only where the format's economics actually turn on them.
 */
const PRIMARY_VERTICALS: Partial<Record<ModuleKind, Vertical[]>> = {
  daypart: ['fnb_qsr', 'fnb_cafe', 'fnb_bakery', 'services_fitness', 'convenience', 'education'],
  whitespace: ['convenience', 'remittance'],
};

/**
 * Is this module a PRIMARY (decision-grade) read for the given vertical, or a secondary/
 * contextual one? territory + lease are always primary; daypart + whitespace depend on the
 * format (see PRIMARY_VERTICALS). Any other module is primary only when the vertical config
 * explicitly activates it. The UI uses this to badge contextual reads honestly.
 */
export function isPrimaryModule(vertical: Vertical, module: ModuleKind): boolean {
  if (module === 'territory' || module === 'lease' || module === 'site_fit') return true;
  const primaryList = PRIMARY_VERTICALS[module];
  if (primaryList) return primaryList.includes(vertical);
  return (EXTRA_BY_VERTICAL[vertical] ?? []).includes(module);
}

/** Extra modules activated per vertical. */
const EXTRA_BY_VERTICAL: Partial<Record<Vertical, ModuleKind[]>> = {
  fnb_qsr: ['daypart', 'informal'],
  fnb_cafe: ['daypart', 'informal'],
  fnb_bakery: ['daypart'],
  retail_apparel: ['mall'],
  retail_specialty: ['mall'],
  services_salon: ['informal'],
  services_spa: ['mall', 'informal'],
  services_fitness: ['daypart'],
  services_laundry: ['informal'],
  convenience: ['whitespace', 'daypart'],
  remittance: ['whitespace'],
  pharmacy: ['healthcare'],
  diagnostics: ['healthcare'],
  fuel: ['land'],
  automotive: ['land'],
  hotel: ['land'],
  education: ['daypart'],
  other: [],
};

/** The full set of modules that should run for a vertical. */
export function modulesForVertical(vertical: Vertical): ModuleKind[] {
  const extras = EXTRA_BY_VERTICAL[vertical] ?? [];
  // De-dup while preserving order.
  return Array.from(new Set([...CORE_MODULES, ...extras]));
}

/** Human labels for module kinds (used in UI + report). */
export const MODULE_LABELS: Record<ModuleKind, string> = {
  site_fit: 'Site Fit',
  financial: 'Financial',
  risk: 'Risk',
  calibration: 'Calibration',
  territory: 'Territory Guard',
  lease: 'Lease Benchmark',
  daypart: 'Daypart & Seasonality',
  whitespace: 'White-Space',
  mall: 'Mall Intelligence',
  healthcare: 'Healthcare Proximity',
  informal: 'Informal-Competitor',
  land: 'Land & Traffic',
  scorecard: 'Site Scorecard',
};

/** Human-friendly vertical names, so the UI never shows a raw enum like "fnb_cafe". */
export const VERTICAL_LABELS: Record<Vertical, string> = {
  fnb_qsr: 'QSR / Fast food',
  fnb_cafe: 'Café',
  fnb_bakery: 'Bakery',
  retail_apparel: 'Apparel retail',
  retail_specialty: 'Specialty retail',
  services_salon: 'Salon',
  services_spa: 'Spa',
  services_fitness: 'Fitness',
  services_laundry: 'Laundry',
  convenience: 'Convenience',
  remittance: 'Remittance',
  pharmacy: 'Pharmacy',
  diagnostics: 'Diagnostics',
  fuel: 'Fuel station',
  automotive: 'Automotive',
  hotel: 'Hotel',
  education: 'Education',
  other: 'Other',
};

/**
 * Friendly display name for a vertical. Accepts the Prisma enum or any string
 * (falls back to Title Case with underscores stripped), so no screen ever shows a
 * raw code like "FNB_CAFE".
 */
export function humanizeVertical(v: string | null | undefined): string {
  if (!v) return '—';
  const known = (VERTICAL_LABELS as Record<string, string>)[v];
  if (known) return known;
  return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
