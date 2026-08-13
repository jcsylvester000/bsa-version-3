/**
 * The nine sections of the Site Intelligence Report — pure definitions, no
 * server-only imports so they're testable and shared.
 *
 * Each section declares which module_result modules ground it and a short purpose.
 * The composer builds the grounded facts for each from those modules, then the AI
 * phrases the prose (retrieve-then-generate). Sections with no supporting data are
 * rendered honestly as "not assessed for this run" rather than invented.
 */
import type { ModuleKind } from '@prisma/client';

export interface SectionDef {
  id: string;
  number: number;
  title: string;
  purpose: string;
  /** module_result modules that ground this section (empty = narrative/summary only). */
  modules: ModuleKind[];
}

export const REPORT_SECTIONS: SectionDef[] = [
  {
    id: 'executive_summary',
    number: 1,
    title: 'Executive Summary',
    purpose: 'The headline verdict per candidate site and the single honest confidence read.',
    modules: ['site_fit', 'territory', 'lease'],
  },
  {
    id: 'site_fit',
    number: 2,
    title: 'Site Fit',
    purpose: 'How well each candidate matches the brand’s format and catchment requirements.',
    modules: ['site_fit'],
  },
  {
    id: 'catchment_demand',
    number: 3,
    title: 'Catchment & Demand',
    purpose: 'Who is in the trade area and whether demand matches the format.',
    modules: ['site_fit', 'daypart', 'whitespace'],
  },
  {
    id: 'competition',
    number: 4,
    title: 'Competition',
    purpose: 'Competitor density and saturation, with informal-competition honesty flags.',
    modules: ['informal', 'mall'],
  },
  {
    id: 'territory',
    number: 5,
    title: 'Territory & Cannibalization',
    purpose: 'Whether the site adds sales or redistributes them across the existing network.',
    modules: ['territory'],
  },
  {
    id: 'financial',
    number: 6,
    title: 'Financial & Lease',
    purpose: 'Lease benchmarking against corridor comps and the financial read.',
    modules: ['lease', 'financial'],
  },
  {
    id: 'risk',
    number: 7,
    title: 'Risk & Regulatory',
    purpose: 'Zoning, regulatory and market risks. Zonal values are tax-reference floors only.',
    modules: ['risk', 'healthcare'],
  },
  {
    id: 'confidence',
    number: 8,
    title: 'Confidence & Data Quality',
    purpose: 'The Truth Layer mix behind this report and where an on-ground check is advised.',
    modules: [],
  },
  {
    id: 'recommendation',
    number: 9,
    title: 'Recommendation',
    purpose: 'The Go / Caution / No-Go read per site — BSA sharpens the shortlist; the broker still closes the deal.',
    modules: ['territory', 'lease', 'site_fit'],
  },
];
