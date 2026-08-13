/**
 * Mock-mode compute — runs Territory Guard and Lease Benchmark against the
 * in-memory demo data using the SAME pure math the DB path uses, so the whole app
 * is clickable end-to-end with no database. Returns the same shapes the API returns
 * in DB mode. Enabled only when isMockAuth() and the demo run id is used.
 */
import { catchmentOverlap } from '@/lib/geo/geo';
import { cannibalizationFraction, catchmentRadius, verdictFromOverlap } from '@/lib/modules/territoryMath';
import { benchmarkLease } from '@/lib/modules/leaseMath';
import { DEMO_OUTLETS, DEMO_SITES, DEMO_OUTLET_SALES, DEMO_LEASE_COMPS_BY_CORRIDOR, demoSiteById } from '@/lib/mock/demoData';
import { nearbyForVertical } from '@/lib/places/placesService';

export const DEMO_RUN_ID = 'mock-run-0000-0000-0000-000000000001';

/**
 * Mock Territory Guard, enriched with REAL competitors from Google Places around
 * each demo candidate (vertical = fnb_cafe → real cafés/milk-tea shops). Async
 * because it calls Places server-side; falls back to no competitors if unavailable.
 */
export async function mockTerritoryGuard(exclusivityRadiusM: number) {
  const results = await Promise.all(DEMO_SITES.map(async (site) => {
    const candidateCatchmentM = catchmentRadius(site.siteType);
    const affected = [];
    for (const o of DEMO_OUTLETS) {
      const ov = catchmentOverlap({ lat: site.lat, lon: site.lon }, { lat: o.lat, lon: o.lon }, candidateCatchmentM, catchmentRadius(o.format));
      if (ov.overlapPct <= 0) continue;
      const sales = DEMO_OUTLET_SALES[o.id] ?? null;
      const cannibalizedPhp = sales != null ? Math.round(sales * cannibalizationFraction(ov.overlapPct)) : 0;
      affected.push({ outletId: o.id, outletName: o.outletName, distanceM: ov.distanceM, overlapPct: ov.overlapPct, outletMonthlySalesPhp: sales, cannibalizedPhp });
    }
    const overlaps = affected.map((a) => a.overlapPct);
    const maxOverlapPct = overlaps.length ? Math.max(...overlaps) : 0;
    const meanOverlapPct = overlaps.length ? Math.round((overlaps.reduce((s, x) => s + x, 0) / overlaps.length) * 10) / 10 : 0;
    const totalCannibalizedPhp = affected.reduce((s, a) => s + a.cannibalizedPhp, 0);
    const verdict = verdictFromOverlap(maxOverlapPct);

    // REAL competitors near this candidate from Google Places (demo vertical = café).
    const realCompetitors = (await nearbyForVertical(site.lat, site.lon, 'fnb_cafe', { radiusM: exclusivityRadiusM, max: 20 }))
      .map((p) => ({ name: p.name, lat: p.lat, lon: p.lon }));

    return {
      candidateSiteId: site.id,
      site: { id: site.id, label: site.label },
      realCompetitors,
      candidateLat: site.lat,
      candidateLon: site.lon,
      candidateCatchmentM,
      exclusivityRadiusM,
      maxOverlapPct,
      meanOverlapPct,
      totalCannibalizedPhp,
      verdict,
      affectedOutlets: affected,
      truth: { overlapPct: 'verified' as const, cannibalizedPhp: 'projected' as const },
      moduleTruthLayer: 'projected' as const,
      flags: verdict === 'redistributes' ? ['high_cannibalization_risk'] : [],
      verdictText:
        `Mock verdict for "${site.label}": ${verdict === 'redistributes' ? 'the site redistributes existing sales' : verdict === 'adds' ? 'the site adds sales' : 'the site partly redistributes sales'} ` +
        `(max overlap ${maxOverlapPct}% Verified; est. ₱${totalCannibalizedPhp.toLocaleString()} cannibalization Projected off an Assumed sales base — chain sales are not public).`,
    };
  }));
  return { runId: DEMO_RUN_ID, exclusivityRadiusM, results };
}

/**
 * A mock 9-section report composed from the mock Territory Guard + Lease results,
 * so the user can see the FINAL output end-to-end with no database. Mirrors the
 * shape the real /api/reports returns.
 */
export async function mockReport() {
  const tg = await mockTerritoryGuard(1500);
  // Asking rate sits mid-band in the real published Makati CBD retail range (~₱1,800–3,000/sqm).
  const lease = mockLeaseBenchmark('mock-s1', 'Makati CBD', 'inline', { baseRentPhpSqm: 2600, escalationPct: 6, cusaPhpSqm: 340, leaseTermYears: 7 });
  // Primary candidate is the first demo site (Makati Ayala Ave).
  const bgc = tg.results.find((r) => r.candidateSiteId === 'mock-s1') ?? tg.results[0];

  // The section card already shows the numbered title, so the body must NOT repeat it,
  // and it must never leak internal tooling notes. Body = the grounded facts, clean.
  const grounded = (_title: string, facts: string[]) =>
    facts.map((f) => `- ${f}`).join('\n');

  const sections = [
    { number: 1, title: 'Executive Summary', assessed: true, truthLayers: ['verified', 'projected', 'assumed'],
      text: grounded('Executive Summary', [
        `Makati Ayala Ave: site-fit strong; Territory Guard says ${bgc.verdict} (max overlap ${bgc.maxOverlapPct}% Verified).`,
        `Lease: asking rent ${lease.verdict.replace('_', ' ')} at the ${lease.baseRentPercentile}th percentile (Assumed).`,
        'Overall confidence: Medium — a mix of Verified measurements and modelled estimates.',
      ]) },
    { number: 2, title: 'Site Fit', assessed: true, truthLayers: ['verified'],
      text: grounded('Site Fit', ['Makati Ayala Ave composite 83.2/100 (Projected from the site-fit model) — strong catchment demand and competitor headroom.']) },
    { number: 3, title: 'Catchment & Demand', assessed: true, truthLayers: ['verified', 'projected'],
      text: grounded('Catchment & Demand', ['Dense daytime population in the BGC catchment; daypart match favourable for a cafe (Projected).']) },
    { number: 4, title: 'Competition', assessed: true, truthLayers: ['verified', 'assumed'],
      text: grounded('Competition', [`${bgc.realCompetitors.length} real competitors within the exclusivity radius (Verified — Google Places) plus an estimated informal count (Assumed); on-ground check advised.`]) },
    { number: 5, title: 'Territory & Cannibalization', assessed: true, truthLayers: ['verified', 'projected'],
      text: grounded('Territory & Cannibalization', [
        `${bgc.verdict === 'redistributes' ? 'The site redistributes existing sales' : 'The site adds sales'} — max overlap ${bgc.maxOverlapPct}% (Verified).`,
        `Estimated monthly cannibalization ₱${bgc.totalCannibalizedPhp.toLocaleString()} (Projected).`,
      ]) },
    { number: 6, title: 'Financial & Lease', assessed: true, truthLayers: ['assumed', 'verified'],
      text: grounded('Financial & Lease', [
        `Asking base rent ₱2,600/sqm is ${lease.verdict.replace('_', ' ')} vs the corridor median (comps Verified, fair-range Assumed).`,
        `Negotiating room ₱${lease.negotiatingRoomPhpSqm}/sqm to the median.`,
      ]) },
    { number: 7, title: 'Risk & Regulatory', assessed: false, truthLayers: [] as string[],
      text: 'Not assessed in this demo — zonal/risk layers are a database-backed step. Zonal values are tax-reference floors only, never a price verdict.' },
    { number: 8, title: 'Confidence & Data Quality', assessed: true, truthLayers: ['verified', 'assumed', 'projected'],
      text: grounded('Confidence & Data Quality', [
        'Verified: overlap %, site-fit, digital competitors, lease comps.',
        'Assumed: informal-competitor estimate, lease fair-range.',
        'Projected: cannibalization ₱, daypart mix. Treat Projected figures as estimates.',
      ]) },
    { number: 9, title: 'Recommendation', assessed: true, truthLayers: ['verified', 'projected', 'assumed'],
      text: grounded('Recommendation', [
        `Makati Ayala Ave: ${bgc.verdict === 'redistributes' ? 'Caution — strong overlap with nearby sister branches; weigh the incremental gain against cannibalization' : 'Go'}.`,
        'BSA sharpens the shortlist and flags the risks; the broker still closes the deal.',
      ]) },
  ];

  return {
    reportId: 'mock-report-1',
    runId: DEMO_RUN_ID,
    confidence: 'med' as const,
    truthLayerMix: { verified: 6, assumed: 3, projected: 3 },
    sections,
    downloadUrl: null,
  };
}

export function mockLeaseBenchmark(candidateSiteId: string, corridor: string, format: string, siteTerms: Record<string, number | undefined>) {
  const site = demoSiteById(candidateSiteId) ?? DEMO_SITES[0];
  // Comps exist for corridors we have a published band for; others return
  // insufficient (honest — the module says the sample is too thin to benchmark).
  const comps = DEMO_LEASE_COMPS_BY_CORRIDOR[corridor] ?? [];
  const out = benchmarkLease(siteTerms, comps);
  const fairRange = out.lowSample ? 'projected' : 'assumed';
  return {
    ...out,
    candidateSiteId: site.id,
    site: { id: site.id, label: site.label },
    corridor,
    format,
    mallName: null,
    comps: comps.map((c) => ({ baseRentPhpSqm: c.baseRentPhpSqm, truthLayer: 'verified' as const, sampleSource: 'demo' })),
    truth: { comps: 'verified' as const, fairRange },
    moduleTruthLayer: fairRange,
    verdictText:
      `Mock verdict for "${site.label}": asking base rent is ${out.verdict.replace('_', ' ')} ` +
      `(${out.baseRentPercentile ?? '?'}th percentile of ${out.sampleSize} comps). ` +
      `[Mock mode — no database.]`,
  };
}
