/**
 * "Gathering place data" / "Updated with new place data" note for a run (2026-10-09).
 *
 * When a run's sites sit where BSA had little or no place data at intake, an automated back-fill
 * (lib/services/autofill.ts) gathers it from OpenStreetMap and recomputes the run. This note tells
 * the user — plainly, with no numbers invented — what they are looking at, and the AutoRefresh
 * child reloads the page every minute while the data is still on its way.
 */
import { AutoRefresh } from '@/components/AutoRefresh';
import { manilaShortStamp } from '@/lib/util/manilaTime';

export interface DataState { state: string | null; pendingAt: string | null; refreshedAt: string | null }

export function dataStateOf(run: { dataRefreshState?: string | null; dataPendingAt?: Date | null; dataRefreshedAt?: Date | null }): DataState {
  return {
    state: run.dataRefreshState ?? null,
    pendingAt: run.dataPendingAt ? run.dataPendingAt.toISOString() : null,
    refreshedAt: run.dataRefreshedAt ? run.dataRefreshedAt.toISOString() : null,
  };
}

export function isGathering(d: DataState | null | undefined): boolean {
  return !!d && (d.state === 'waiting' || d.state === 'due' || d.state === 'running');
}

export function DataGatheringNote({ data, compact = false }: { data: DataState | null | undefined; compact?: boolean }) {
  if (!data?.state) return null;
  if (isGathering(data)) {
    return (
      <div role="status" className="card-inset flex flex-wrap items-start gap-3 border-caution/50 p-4 text-body">
        <span aria-hidden className="text-caution">◌</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink-text">{data.state === 'running' ? 'Updating this analysis with new place data…' : 'Gathering place data for this area'}</p>
          {!compact && (
            <p className="mt-1 text-label font-normal text-ink-muted">
              BSA had few or no mapped places (shops, transport, schools, clinics) around {data.state === 'waiting' ? 'one or more of these sites' : 'these sites'} when you submitted.
              The results below use what BSA has now, so treat nearby-place counts as incomplete. The missing places are being collected
              automatically from OpenStreetMap, and this analysis recomputes itself when they arrive — usually within the hour. Nothing is estimated in the meantime.
            </p>
          )}
        </div>
        <AutoRefresh everyMs={60_000} />
      </div>
    );
  }
  if (data.state === 'unavailable') {
    return (
      <div role="status" className="card-inset flex items-start gap-3 border-caution/50 p-4 text-body">
        <span aria-hidden className="text-caution">▲</span>
        <p className="min-w-0 flex-1">
          <span className="font-semibold text-ink-text">Place data around these sites is still limited</span>
          <span className="text-label font-normal text-ink-muted"> — BSA could not collect it automatically this time; it is on the admins&apos; capture list. The results below use what BSA has, so treat nearby-place counts as incomplete and confirm on the ground.</span>
        </p>
      </div>
    );
  }
  if (data.state === 'done' && data.refreshedAt) {
    return (
      <div role="status" className="card-inset flex items-start gap-3 border-go/50 p-4 text-body">
        <span aria-hidden className="text-go">✓</span>
        <p className="min-w-0 flex-1">
          <span className="font-semibold text-ink-text">Updated with new place data</span>
          <span className="text-label font-normal text-ink-muted"> — recomputed automatically {manilaShortStamp(new Date(data.refreshedAt))} after BSA collected the places around these sites.</span>
        </p>
      </div>
    );
  }
  return null;
}
