/**
 * Methodology corpus — the real BSA reference text the AI retrieve step grounds on.
 *
 * These chunks are the actual methodology and Truth-Layer guardrails for each module
 * (Territory Guard, Lease Benchmark, Daypart, White-Space, Healthcare, Land & Traffic,
 * Site Scorecard), plus the cross-cutting Truth-Layer and broker-supplementation
 * discipline. They are Verified reference material — how BSA reasons, not invented data.
 *
 * Idempotent: upsert on the doc_chunk natural key (sourceTable, sourceId, chunkIndex).
 * Shared by both prisma/seed.ts and prisma/populate.ts.
 */
import { prisma } from '@/lib/db/prisma';

interface Chunk { id: string; content: string; truth: 'verified' | 'assumed' | 'projected'; }

export const METHODOLOGY_CHUNKS: Chunk[] = [
  {
    id: 'method-territory',
    content:
      'Territory Guard measures the trade-area overlap between a candidate site and each existing outlet. Overlap percentage is computed from coordinates and the exclusivity radius, and is Verified. The share of the new branch volume that is cannibalized versus incremental is a Projected estimate and must be labelled as such. A high overlap means the site redistributes existing sales rather than adding new sales; a low overlap means the catchment is largely fresh.',
    truth: 'verified',
  },
  {
    id: 'method-exclusivity',
    content:
      'The exclusivity radius is a defensible minimum distance a franchise agreement can cite. Setting it larger widens each outlet catchment and increases measured overlap. BSA sharpens the shortlist and flags cannibalization risk; the broker still closes the deal and an on-ground visit remains recommended.',
    truth: 'verified',
  },
  {
    id: 'guardrail-truth',
    content:
      'Every number BSA reports carries a Truth Layer classification: Verified for measured or sourced facts, Assumed for estimates with a stated basis, Projected for modelled figures. Real coordinates from a mapping source are Verified. A chain’s branch-level sales, a mall’s footfall, and a broker’s rent estimate are not public and are Assumed. Model outputs such as cannibalization share or demand-curve fit are Projected. Zonal values are tax-reference floors only and are never presented as a market-price verdict.',
    truth: 'verified',
  },
  {
    id: 'method-lease',
    content:
      'Lease Benchmark compares a site asking rent, escalation, CUSA, lease term and fit-out against comparable leases for the same format and corridor. The comparable comps are Verified against source leases or published corridor bands. The fair-range read — the percentile of the asking rate within the corridor spread and the negotiating room to the median — is an Assumed estimate shown with its sample size, and is low-confidence when the sample is thin. A rate above the corridor median means the tenant is likely overpaying and has room to negotiate down toward the median. BSA sharpens the negotiation; the broker still closes the deal.',
    truth: 'verified',
  },
  {
    id: 'method-daypart',
    content:
      'Daypart & Seasonality reads when demand occurs, not just who lives in the catchment. A daytime-population share drives a 24-hour demand curve: an office-led catchment peaks midday (11:00–14:00), a residential catchment peaks in the evening (17:00–20:00). The peak-hour-demand-captured figure is the share of modelled demand that falls inside the format’s target window, and is Projected. A dwell-time format should land in a catchment whose peak hours match its operating model.',
    truth: 'verified',
  },
  {
    id: 'method-whitespace',
    content:
      'White-Space maps demand-versus-supply across a grid of the target market. A cell with high demand indicators (population, daytime population, income fit) and low own-and-competitor supply is an under-served gap and a network-expansion candidate. Demand indicators from census are Verified; the gap score that ranks cells is Projected. White-Space guides where to look next; it does not replace a site-level Territory Guard and Lease read on a specific address.',
    truth: 'verified',
  },
  {
    id: 'method-healthcare',
    content:
      'Healthcare Proximity scores a site by its access to referral sources — hospitals, clinics and diagnostic centers — within the catchment. Facility locations are Verified from a mapping source. Referral-volume potential is Assumed because patient flows are not public. For a pharmacy or diagnostics concept, proximity to a cluster of clinics and a hospital raises the referral base; isolation from them lowers it.',
    truth: 'verified',
  },
  {
    id: 'method-land',
    content:
      'Land & Traffic screens land-intensive formats (fuel, drive-through, automotive) on frontage, corner position, accessibility and traffic exposure. Road adjacency and corner geometry are Verified from the map. Vehicle-count and turn-in convenience are Assumed until a traffic study is commissioned. A corner lot on an arterial with easy ingress scores higher than a mid-block lot on a secondary road.',
    truth: 'verified',
  },
  {
    id: 'method-scorecard',
    content:
      'The Site Scorecard is a fast self-serve read for a walk-in site: it runs the applicable modules and returns a single Go / Caution / No-Go verdict with the pillar scores behind it. The verdict is Projected — a decision aid, not a guarantee. A No-Go on a strong-overlap site tells the franchisee the location redistributes an existing branch; a Go with caution flags a specific risk to check on the ground.',
    truth: 'verified',
  },
  {
    id: 'guardrail-broker',
    content:
      'BSA supplements brokers; it does not replace them. Every module is framed to sharpen a human decision — shortlist a site, price a lease, size a territory — and each output recommends the broker still verify on the ground and close the deal. BSA never claims to have visited a site or to guarantee a commercial outcome.',
    truth: 'verified',
  },
  {
    id: 'guardrail-sources',
    content:
      'Data sourcing is honest by table. Establishment coordinates come from Google Places and are Verified. BIR zonal values come from published RDO schedules and are Verified where the full range is sourced, Assumed where only a band is inferred. PSA census populations are Verified; daytime-population projections are Assumed. Lease comps are Verified against source leases or published corridor bands, and Assumed where a broker estimate fills a gap. No figure is presented as Verified unless a real source backs it.',
    truth: 'verified',
  },

  /* ---- Analysis Report interpretation reference -------------------------------
     How the Analysis AI reads each field of the strict JSON. Retrieved by the
     retrieve step so the model interprets figures correctly without recomputing. */
  {
    id: 'analysis-overview',
    content:
      'The Analysis Report is a written interpretation, not a new calculation. It reads one strict JSON block holding the operator intake, the composite verdict and score, and the four site modules — Territory Guard, Lease Benchmark, Daypart Demand and White-Space — each figure already computed and Truth-Layer tagged. The report cites only numbers present verbatim in that JSON, preserves each figure’s Truth Layer, and never invents, averages, or extrapolates. A module with ran:false or null is named as a gap, not filled in. The composite verdict and score are the headline; the modules explain why.',
    truth: 'verified',
  },
  {
    id: 'analysis-territory-read',
    content:
      'Reading Territory Guard in the analysis: territory.maxOverlapPct is the headline trade-area overlap (Verified from coordinates) and territory.headlineSource says whether it is driven by the operator’s own branch (own) or by competitive saturation (competitive). territory.verdict is adds / mixed / redistributes — adds means fresh catchment, redistributes means the site cannibalizes existing sales. territory.competitiveSaturationPct and competitorMix (direct/adjacent/unrelated) size the rivalry; territory.totalCannibalizedPhp is a Projected peso model, described as modelled, never as booked loss. A high overlap on a redistributes verdict is the strongest single reason to caution a site.',
    truth: 'verified',
  },
  {
    id: 'analysis-lease-read',
    content:
      'Reading Lease Benchmark in the analysis: lease.verdict places the asking rent versus the corridor — below_market, at_market, above_market, insufficient_data, or corridor_benchmark. lease.baseRentPercentile and lease.corridor locate it in the spread; a high percentile means room to negotiate down toward the median. lease.sampleSize and lease.lowSample gate confidence — a thin sample makes any range indicative, not a verdict. lease.zonal.crossCheck.position compares rent against the BIR zonal floor, and lease.zonal.usedAsFallback:true means the indicative band stood in for missing comps. Zonal is a tax-reference floor only; the analysis never states what rent to pay or whether to sign.',
    truth: 'verified',
  },
  {
    id: 'analysis-daypart-read',
    content:
      'Reading Daypart Demand in the analysis: daypart.windowMatchPct is the Projected share of modelled demand falling inside the format’s target window, and daypart.daytimeShare with daypart.peakHour say whether the catchment is office-led (midday peak) or residential (evening peak). daypart.seasonality gives the peak and trough seasons and any term-time note. Daypart is weighted only when daypart.isPrimary is true for the format; when it is not primary, or daypart.noCatchmentData is true, the analysis mentions it lightly and says so rather than leaning on it.',
    truth: 'verified',
  },
  {
    id: 'analysis-whitespace-read',
    content:
      'Reading White-Space in the analysis: whitespace.recommendations lists the top alternative areas the operator did not input, each with a Projected cannibalizationPct and a verdict (open / workable / contested). An entry with beatsProposed:true undercuts whitespace.proposed.cannibalizationPct — the cannibalization at the operator’s own chosen site — and is named as a better alternative with the size of the gap. White-Space guides where to look next; it never overrides the site-level Territory and Lease read on the specific address under review.',
    truth: 'verified',
  },
  {
    id: 'analysis-composite-confidence',
    content:
      'Reading the composite and confidence: composite.verdict and composite.score are the roll-up the analysis opens with. meta.overallConfidence (high / medium / low) reflects how much of the read rests on Verified versus Assumed or Projected inputs, and drops when a module is on-ground-flagged or comps are thin — truthLayerSummary counts the Verified, Assumed and Projected data points behind the report. The closing line pairs that confidence with the single most important thing to verify on the ground, drawn only from a flags entry or an Assumed/Projected field — never a new recommendation.',
    truth: 'verified',
  },
];

/** Upsert the methodology corpus. Returns the number of chunks written. */
export async function seedMethodologyChunks(): Promise<number> {
  for (const c of METHODOLOGY_CHUNKS) {
    await prisma.docChunk.upsert({
      where: { doc_chunk_natural_key: { sourceTable: 'method', sourceId: c.id, chunkIndex: 0 } },
      update: { content: c.content, truthLayer: c.truth },
      create: { sourceTable: 'method', sourceId: c.id, chunkIndex: 0, content: c.content, truthLayer: c.truth },
    });
  }
  return METHODOLOGY_CHUNKS.length;
}
