import { PlacesExplorer } from '@/components/PlacesExplorer';

export const dynamic = 'force-dynamic';

export default function ExplorePage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-ink-text">Explore Establishments</h1>
        <p className="text-sm text-ink-muted">
          Plot establishments from the database on the OpenStreetMap basemap — the same data that feeds Territory
          Guard’s competition read. Pick an area and type, or search a brand’s outlets by name.
        </p>
      </div>
      <PlacesExplorer />
    </div>
  );
}
