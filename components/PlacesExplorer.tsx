'use client';

import { useEffect, useMemo, useState } from 'react';
import { TerritoryMap, type MapCompetitor, type MapOutlet } from '@/components/TerritoryMap';

/**
 * Explore where the competition is — so you don't cannibalize your own business.
 *
 * Everything is DB-driven and plotted on OpenStreetMap (no Google calls):
 *  - Area + category dropdowns are built from what's actually in the database (with counts).
 *  - Results can be sorted (name / distance) and filtered live by a search box.
 *  - A category breakdown shows the competitive mix in the selected area.
 *  - A "my brand" overlay marks your own outlets so you see gaps vs overlap.
 */
interface Tagged { name: string; lat: number; lon: number; area: string | null; category: string; categoryLabel: string }
interface Area { area: string; count: number; lat: number; lon: number }
interface Cat { key: string; label: string; count: number }

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLon = toRad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function PlacesExplorer() {
  const [mode, setMode] = useState<'nearby' | 'brand'>('nearby');

  // Facets from the DB
  const [areas, setAreas] = useState<Area[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [facetsLoaded, setFacetsLoaded] = useState(false);

  // Controls
  const [areaIdx, setAreaIdx] = useState(0);
  const [category, setCategory] = useState('all');
  const [radiusM, setRadiusM] = useState(1500);
  const [brandQuery, setBrandQuery] = useState('');
  const [myBrand, setMyBrand] = useState('');
  const [sortBy, setSortBy] = useState<'distance' | 'name'>('distance');
  const [filterText, setFilterText] = useState('');

  // Results
  const [center, setCenter] = useState<{ lat: number; lon: number; label: string } | null>(null);
  const [places, setPlaces] = useState<Tagged[]>([]);
  const [myOutlets, setMyOutlets] = useState<Array<{ name: string; lat: number; lon: number }>>([]);
  const [breakdown, setBreakdown] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/explore/facets').then((r) => r.json()).then((j) => {
      if (j.ok) { setAreas(j.data.areas); setCats(j.data.categories); }
      setFacetsLoaded(true);
    }).catch(() => setFacetsLoaded(true));
  }, []);

  async function search() {
    setLoading(true); setError(null);
    if (mode === 'brand') {
      const res = await fetch('/api/explore', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'brand', query: brandQuery, max: 150 }),
      }).then((r) => r.json());
      setLoading(false);
      if (!res.ok) { setError(res.error?.message ?? 'Search failed.'); return; }
      const found: Tagged[] = res.data.places;
      setPlaces(found); setMyOutlets([]); setBreakdown([]);
      if (found.length) setCenter({ lat: found[0].lat, lon: found[0].lon, label: brandQuery });
      else setError('No matching establishments in the database. Try a different name.');
      return;
    }
    const area = areas[areaIdx];
    if (!area) { setLoading(false); setError('No areas with data yet.'); return; }
    const c = { lat: area.lat, lon: area.lon, label: area.area };
    setCenter(c);
    const res = await fetch('/api/explore', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'nearby', lat: c.lat, lon: c.lon, category, radiusM, max: 150, myBrand: myBrand || undefined }),
    }).then((r) => r.json());
    setLoading(false);
    if (!res.ok) { setError(res.error?.message ?? 'Lookup failed.'); return; }
    setPlaces(res.data.places); setMyOutlets(res.data.myOutlets ?? []); setBreakdown(res.data.breakdown ?? []);
  }

  // Sorted + filtered view of the plotted results.
  const view = useMemo(() => {
    let v = [...places];
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      v = v.filter((p) => p.name.toLowerCase().includes(q) || p.categoryLabel.toLowerCase().includes(q));
    }
    if (sortBy === 'name') v.sort((a, b) => a.name.localeCompare(b.name));
    else if (center) v.sort((a, b) => haversineM(center.lat, center.lon, a.lat, a.lon) - haversineM(center.lat, center.lon, b.lat, b.lon));
    return v;
  }, [places, filterText, sortBy, center]);

  const competitorMarks: MapCompetitor[] = view.map((p) => ({ name: `${p.name} · ${p.categoryLabel}`, lat: p.lat, lon: p.lon }));
  const ownMarks: MapOutlet[] = myOutlets.map((o, i) => ({ id: `own-${i}`, name: `You: ${o.name}`, lat: o.lat, lon: o.lon, catchmentM: 700 }));

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <div className="mb-3 flex gap-2">
          <button onClick={() => setMode('nearby')} className={`rounded-lg px-3 py-1.5 text-sm ${mode === 'nearby' ? 'bg-accent text-ink-bg' : 'bg-ink-panel-2 text-ink-muted'}`}>Nearby by category</button>
          <button onClick={() => setMode('brand')} className={`rounded-lg px-3 py-1.5 text-sm ${mode === 'brand' ? 'bg-accent text-ink-bg' : 'bg-ink-panel-2 text-ink-muted'}`}>Find a brand’s outlets</button>
        </div>

        {mode === 'nearby' ? (
          <div className="space-y-3">
            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="text-sm font-medium text-ink-text">Area</span>
                <select value={areaIdx} onChange={(e) => setAreaIdx(Number(e.target.value))} className="field mt-1">
                  {areas.map((a, i) => <option key={a.area} value={i}>{a.area} ({a.count})</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink-text">Category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="field mt-1">
                  <option value="all">All categories</option>
                  {cats.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.count})</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink-text">Radius (m)</span>
                <input type="number" value={radiusM} min={200} max={5000} step={100} onChange={(e) => setRadiusM(Number(e.target.value))} className="field mt-1" />
              </label>
            </div>
            <label className="block">
              <span className="text-sm font-medium text-ink-text">My brand (optional — highlight my own outlets to avoid cannibalization)</span>
              <input value={myBrand} onChange={(e) => setMyBrand(e.target.value)} placeholder="e.g. Macao Imperial Tea" className="field mt-1" />
            </label>
          </div>
        ) : (
          <label className="block">
            <span className="text-sm font-medium text-ink-text">Brand / chain name</span>
            <input value={brandQuery} onChange={(e) => setBrandQuery(e.target.value)} placeholder="e.g. Jollibee, Mercury Drug, 7-Eleven, Starbucks" className="field mt-1" />
            <span className="mt-1 block text-xs text-ink-muted">Searches the database for outlets whose name matches — plots them across the region.</span>
          </label>
        )}

        <button onClick={search} disabled={loading || !facetsLoaded} className="mt-4 btn-accent">
          {loading ? 'Searching…' : !facetsLoaded ? 'Loading data…' : 'Explore'}
        </button>
        {error && <p className="mt-3 text-sm text-nogo">{error}</p>}
      </div>

      {!center && facetsLoaded && (
        <p className="rounded-lg border border-dashed border-ink-border p-8 text-center text-ink-muted">
          Pick an area and category — or search a brand — then Explore to plot competition from the database on the map.
        </p>
      )}

      {center && (
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-3">
            <TerritoryMap
              outlets={ownMarks}
              competitors={competitorMarks}
              candidate={{ id: `explore-${center.lat}-${center.lon}-${category}`, label: center.label, lat: center.lat, lon: center.lon, catchmentM: radiusM, verdict: 'mixed' }}
            />
            <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-muesli align-middle" />{view.length} competitor{view.length === 1 ? '' : 's'} plotted</span>
              {ownMarks.length > 0 && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-nile-blue align-middle" />{ownMarks.length} of your own outlets</span>}
            </div>
            {breakdown.length > 0 && (
              <div className="card p-4">
                <p className="mb-2 text-sm font-medium text-ink-text">Competitive mix in {center.label} (within {radiusM} m)</p>
                <div className="flex flex-wrap gap-2">
                  {breakdown.map((b) => (
                    <button
                      key={b.key}
                      onClick={() => setCategory(category === b.key ? 'all' : b.key)}
                      className={`rounded-full px-3 py-1 text-xs ${category === b.key ? 'bg-accent text-ink-bg' : 'bg-ink-panel-2 text-ink-muted hover:bg-ink-hover'}`}
                    >
                      {b.label} · {b.count}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[11px] text-ink-muted">Click a category to filter the map to it.</p>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            <div className="card p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-text">Results</p>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'distance' | 'name')} className="field w-auto text-xs">
                  <option value="distance">Sort: nearest first</option>
                  <option value="name">Sort: name (A–Z)</option>
                </select>
              </div>
              <input value={filterText} onChange={(e) => setFilterText(e.target.value)} placeholder="Filter results…" className="field mb-2 text-sm" />
              {view.length === 0 ? (
                <p className="text-sm text-ink-muted">None found for this area/category.</p>
              ) : (
                <ul className="max-h-[420px] space-y-1 overflow-auto text-sm">
                  {view.map((p, i) => (
                    <li key={i} className="border-b border-ink-border py-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-ink-text">{p.name}</span>
                        {/* Distance is only meaningful in 'nearby' mode (from the chosen
                            area centre). In brand mode there is no reference point — the
                            map centres on an arbitrary first outlet — so we hide it rather
                            than show a confusing "0 m". */}
                        {mode === 'nearby' && center && <span className="shrink-0 text-xs text-ink-muted">{Math.round(haversineM(center.lat, center.lon, p.lat, p.lon))} m</span>}
                      </div>
                      <span className="text-[11px] text-ink-muted">{p.categoryLabel}</span>
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
