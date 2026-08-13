'use client';

import { useState } from 'react';
import { TerritoryMap, type MapOutlet } from '@/components/TerritoryMap';
import { TruthChip } from '@/components/TruthChip';
import { AnalysisOverlay } from '@/components/AnalysisSequence';
import { InfoHint } from '@/components/InfoHint';

interface AffectedOutlet {
  outletName: string;
  distanceM: number;
  overlapPct: number;
  cannibalizedPhp: number;
}
interface SiteResult {
  candidateSiteId: string;
  site: { id: string; label: string };
  maxOverlapPct: number;
  meanOverlapPct: number;
  totalCannibalizedPhp: number;
  candidateCatchmentM: number;
  verdict: 'adds' | 'mixed' | 'redistributes';
  affectedOutlets: AffectedOutlet[];
  verdictText: string;
  candidateLat: number;
  candidateLon: number;
  realCompetitors?: Array<{ name: string; lat: number; lon: number }>;
  mapCompetitors?: Array<{ name: string; lat: number; lon: number }>;
}

const VERDICT_LABEL: Record<string, { label: string; cls: string }> = {
  adds: { label: 'Adds sales', cls: 'text-go' },
  mixed: { label: 'Mixed — some redistribution', cls: 'text-caution' },
  redistributes: { label: 'Redistributes existing sales', cls: 'text-nogo' },
};

/**
 * Deterministic one-line verdict summary built from the actual scores (no AI text).
 * Explains WHY the verdict landed where it did, and how many competitors sit in the
 * catchment — so the read is honest and self-contained.
 */
function verdictSummary(r: SiteResult): string {
  const comps = r.mapCompetitors?.length ?? 0;
  const sameConcept = r.realCompetitors?.length ?? 0;
  const compClause = comps > 0
    ? ` ${comps} competing establishment${comps === 1 ? '' : 's'} sit in the catchment${sameConcept > 0 ? ` (${sameConcept} same-concept)` : ''}.`
    : ' No competing establishments found in the catchment.';

  // Only cite a peso figure when we actually have one (needs branch sales on file);
  // otherwise stay honest about the overlap without a misleading ₱0.
  const cannibClause = r.totalCannibalizedPhp > 0
    ? ` (~₱${r.totalCannibalizedPhp.toLocaleString()}/mo cannibalized)`
    : '';

  if (r.verdict === 'adds') {
    return `Fresh catchment — ${r.maxOverlapPct}% overlap with your nearest branch, so this site adds new sales rather than eating an existing one.${compClause}`;
  }
  if (r.verdict === 'redistributes') {
    return `Heavy overlap — ${r.maxOverlapPct}% with an existing branch${cannibClause}, so this site mostly redistributes sales you already have.${compClause}`;
  }
  return `Partial overlap — ${r.maxOverlapPct}% with an existing branch, a mix of new and redistributed sales${cannibClause}.${compClause}`;
}

export function TerritoryGuardView({
  runId,
  initialRadiusM,
  outlets,
}: {
  runId: string;
  initialRadiusM: number;
  outlets: MapOutlet[];
}) {
  const [radius, setRadius] = useState(initialRadiusM);
  const [results, setResults] = useState<SiteResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  // The generate animation plays ONLY when the user clicks Run (a deliberate result gen).
  const [animating, setAnimating] = useState(false);
  const [pending, setPending] = useState<SiteResult[] | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setAnimating(true); // start the overlay the moment the user asks for a result
    const res = await fetch('/api/territory-guard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId, exclusivityRadiusM: radius }),
    });
    const json = await res.json();
    setLoading(false);
    if (!json.ok) {
      setAnimating(false);
      setError(json.error?.message ?? 'Run failed.');
      return;
    }
    // Hold the results until the animation finishes, then reveal together.
    setPending(json.data.results);
  }

  const activeResult = results?.[active];

  return (
    <div className="space-y-6">
      <AnalysisOverlay
        feature="territory"
        active={animating}
        onDone={() => { setAnimating(false); if (pending) { setResults(pending); setActive(0); setPending(null); } }}
      />
      <div className="card p-4">
        <div className="flex flex-wrap items-end gap-4">
          <label className="block">
            <span className="text-sm font-medium text-ink-text">Exclusivity radius (metres)</span>
            <input
              type="number"
              min={100}
              max={20000}
              step={100}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              className="field mt-1 w-40"
            />
          </label>
          <button
            onClick={run}
            disabled={loading}
            className="btn-accent"
          >
            {loading ? 'Running…' : 'Run Territory Guard'}
          </button>
          <p className="text-xs text-ink-muted">
            A defensible minimum distance a franchise agreement can cite. Larger radius → wider catchments → more measured overlap.
          </p>
        </div>
        {error && <p className="mt-3 text-sm text-nogo">{error}</p>}
      </div>

      {!results && (
        <p className="rounded-lg border border-dashed border-ink-border p-8 text-center text-ink-muted">
          Set a radius and run to measure trade-area overlap against the existing network.
        </p>
      )}

      {results && activeResult && (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-3">
            {results.length > 1 && (
              <div className="flex gap-2">
                {results.map((r, i) => (
                  <button
                    key={r.candidateSiteId}
                    onClick={() => setActive(i)}
                    className={`rounded-lg px-3 py-1.5 text-sm ${
                      i === active ? 'bg-accent text-ink-bg' : 'bg-ink-panel-2 text-ink-muted'
                    }`}
                  >
                    {r.site.label}
                  </button>
                ))}
              </div>
            )}
            <TerritoryMap
              outlets={outlets}
              competitors={(activeResult.mapCompetitors?.length ? activeResult.mapCompetitors : activeResult.realCompetitors) ?? []}
              candidate={{
                id: activeResult.candidateSiteId,
                label: activeResult.site.label,
                lat: activeResult.candidateLat,
                lon: activeResult.candidateLon,
                catchmentM: activeResult.candidateCatchmentM,
                verdict: activeResult.verdict,
              }}
            />
            {((activeResult.mapCompetitors?.length ?? activeResult.realCompetitors?.length) ?? 0) > 0 && (
              <p className="text-xs text-ink-muted">
                <span className="mr-1 inline-block h-2 w-2 rounded-full bg-muesli align-middle" />
                {activeResult.mapCompetitors?.length ?? activeResult.realCompetitors!.length} nearby establishments plotted from the database
                {(activeResult.realCompetitors?.length ?? 0) > 0 && ` · ${activeResult.realCompetitors!.length} same-concept`}.
              </p>
            )}
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="card p-5">
              <p className="inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-ink-muted">Verdict <InfoHint text="'Adds' = fresh catchment, the site brings new sales. 'Redistributes' = it heavily overlaps an existing branch and mostly eats your own sales (cannibalization). Overlap % is measured from coordinates." /></p>
              <p className={`mt-1 text-xl font-bold ${VERDICT_LABEL[activeResult.verdict].cls}`}>
                {VERDICT_LABEL[activeResult.verdict].label}
              </p>
              <p className="mt-2 text-sm text-ink-muted">{verdictSummary(activeResult)}</p>
            </div>

            <div className="card p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">Max overlap</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{activeResult.maxOverlapPct}%</span>
                  <TruthChip layer="verified" />
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">Mean overlap</span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{activeResult.meanOverlapPct}%</span>
                  <TruthChip layer="verified" />
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-ink-muted">Est. monthly cannibalization</span>
                {activeResult.totalCannibalizedPhp > 0 ? (
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">₱{activeResult.totalCannibalizedPhp.toLocaleString()}</span>
                    <TruthChip layer="projected" />
                  </span>
                ) : (
                  <span className="text-sm text-ink-muted" title="Projecting a peso figure needs your existing branches' monthly sales, which aren't on file for this network.">Not estimated — no branch sales on file</span>
                )}
              </div>
            </div>

            <div className="card p-5">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-ink-text">Competition at this site</p>
                <span className="text-xs text-ink-muted">within {activeResult.candidateCatchmentM} m</span>
              </div>
              {(activeResult.mapCompetitors?.length ?? 0) === 0 ? (
                <p className="text-sm text-ink-muted">No competing establishments found in the catchment.</p>
              ) : (
                <>
                  <p className="text-sm text-ink-text">
                    <span className="font-semibold">{activeResult.mapCompetitors!.length}</span> nearby establishment{activeResult.mapCompetitors!.length === 1 ? '' : 's'}
                    {(activeResult.realCompetitors?.length ?? 0) > 0 && (
                      <span className="text-ink-muted"> · {activeResult.realCompetitors!.length} same-concept</span>
                    )}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs text-ink-muted">
                    {activeResult.mapCompetitors!.slice(0, 5).map((c, i) => (
                      <li key={`${c.name}-${i}`} className="flex items-center gap-2">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-muesli" />
                        {c.name}
                      </li>
                    ))}
                    {activeResult.mapCompetitors!.length > 5 && (
                      <li className="text-ink-muted">+ {activeResult.mapCompetitors!.length - 5} more on the map</li>
                    )}
                  </ul>
                </>
              )}
            </div>

            <div className="card p-5">
              <p className="mb-2 text-sm font-medium text-ink-text">Affected outlets (your branches)</p>
              {activeResult.affectedOutlets.length === 0 ? (
                <p className="text-sm text-ink-muted">No existing branch overlaps this catchment.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {activeResult.affectedOutlets.map((a, i) => (
                    <li key={`${a.outletName}-${i}`} className="flex items-center justify-between">
                      <span className="text-ink-muted">{a.outletName}</span>
                      <span className="text-ink-muted">
                        {a.overlapPct}% · {a.distanceM} m
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
