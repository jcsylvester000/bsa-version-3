/**
 * Per-feature "analysis sequence" configs — the streaming status lines and the
 * motif shown during the 8-second futuristic overlay that plays on every data load.
 *
 * Pure data (no imports) so it is unit-testable and shared by the client component.
 * The steps are cosmetic — the data is already computed; this narrates a believable
 * series of tasks so the reveal feels earned. Each feature gets a unique sequence.
 */

export type Motif = 'radar' | 'grid' | 'bars' | 'curve' | 'scan' | 'network';

export interface AnalysisConfig {
  /** Feature title shown in the console header. */
  title: string;
  /** Which animated motif to render alongside the log. */
  motif: Motif;
  /** Ordered status lines streamed over the 8 seconds (aim for 6–8). */
  steps: string[];
}

export const ANALYSIS_CONFIGS: Record<string, AnalysisConfig> = {
  dashboard: {
    title: 'Site Intelligence Engine',
    motif: 'grid',
    steps: [
      'Initializing analysis session…',
      'Loading franchisor outlet network…',
      'Georeferencing candidate sites…',
      'Cross-referencing competitor establishments…',
      'Scoring pillars · demand · competition · access…',
      'Rolling up Truth-Layer confidence…',
      'Ranking shortlist…',
      'Compiling Site Intelligence…',
    ],
  },
  territory: {
    title: 'Territory Guard',
    motif: 'radar',
    steps: [
      'Acquiring candidate coordinates…',
      'Sweeping trade-area within exclusivity radius…',
      'Locating existing outlets in range…',
      'Matching competitors from the establishments database…',
      'Computing catchment overlap geometry…',
      'Modelling cannibalization vs incremental…',
      'Resolving verdict…',
      'Rendering overlap map…',
    ],
  },
  lease: {
    title: 'Lease Benchmark',
    motif: 'bars',
    steps: [
      'Identifying corridor…',
      'Retrieving comparable leases…',
      'Normalizing base rent · CUSA · escalation…',
      'Building the corridor rent distribution…',
      'Locating the asking rate percentile…',
      'Computing negotiating room to median…',
      'Grading sample confidence…',
      'Composing benchmark…',
    ],
  },
  daypart: {
    title: 'Daypart & Seasonality',
    motif: 'curve',
    steps: [
      'Reading catchment composition…',
      'Weighting office vs residential share…',
      'Modelling the 24-hour demand curve…',
      'Detecting peak windows…',
      'Matching format operating hours…',
      'Scoring peak-hour capture…',
      'Rendering demand curve…',
    ],
  },
  whitespace: {
    title: 'White-Space Planner',
    motif: 'grid',
    steps: [
      'Tiling the target market…',
      'Overlaying population + income…',
      'Mapping existing network footprint…',
      'Subtracting competitor supply…',
      'Computing demand-minus-supply per cell…',
      'Ranking under-served gaps…',
      'Rendering opportunity heatmap…',
    ],
  },
  healthcare: {
    title: 'Healthcare Proximity',
    motif: 'network',
    steps: [
      'Locating candidate catchment…',
      'Indexing hospitals · clinics · diagnostics…',
      'Measuring referral-source distances…',
      'Weighting proximity to referral base…',
      'Scoring healthcare access…',
      'Compiling proximity read…',
    ],
  },
  land: {
    title: 'Land & Traffic Screen',
    motif: 'scan',
    steps: [
      'Locating land parcel…',
      'Screening road frontage + corner geometry…',
      'Estimating traffic exposure…',
      'Checking accessibility · ingress / egress…',
      'Scoring land suitability…',
      'Compiling land screen…',
    ],
  },
  report: {
    title: 'Report Composer',
    motif: 'scan',
    steps: [
      'Gathering module results…',
      'Retrieving grounded methodology…',
      'Classifying every figure · Verified / Assumed / Projected…',
      'Composing nine report sections…',
      'Assembling Truth-Layer summary…',
      'Finalizing recommendation…',
    ],
  },
  scorecard: {
    title: 'Site Scorecard',
    motif: 'radar',
    steps: [
      'Reading walk-in site…',
      'Running applicable modules…',
      'Measuring overlap + competition…',
      'Aggregating pillar scores…',
      'Resolving Go / Caution / No-Go…',
      'Rendering scorecard…',
    ],
  },
};

/** Fallback config for any feature without a specific one. */
export const DEFAULT_ANALYSIS: AnalysisConfig = {
  title: 'Analyzing',
  motif: 'scan',
  steps: [
    'Initializing analysis session…',
    'Retrieving datasets…',
    'Running computations…',
    'Classifying Truth Layers…',
    'Compiling results…',
  ],
};

export function analysisConfig(key: string): AnalysisConfig {
  return ANALYSIS_CONFIGS[key] ?? DEFAULT_ANALYSIS;
}

/** Total sequence duration in ms (kept in one place so component + tests agree). */
export const ANALYSIS_DURATION_MS = 8000;
