/**
 * R-08 — regional end-to-end wiring QA for Cavite + Batangas.
 *
 * This is a REGRESSION GUARD, not a data test. It walks a representative set of provincial sites
 * through the same deterministic resolvers the live pipeline uses and asserts the whole region-aware
 * chain stays coherent:
 *   site → regionForSite → canonicalCity(region, LGU) → inferCorridor (lease + daypart) →
 *   psaRegion (zonal lookup) → corridor name (traffic_corridor key)
 *
 * The one failure mode this must never allow again: a Cavite/Batangas site silently resolving to an
 * NCR corridor / NCR zonal region (the pre-R-06 "Bacoor → NCR Las Piñas" bug). It also pins the
 * corridor↔traffic-template contract: the corridor names here are exactly the keys the shipped
 * traffic templates (prisma/data/traffic/{cavite,batangas}.template.json) use — rename a corridor in
 * the registry and this fails, reminding you to update the template too.
 */
import { describe, it, expect } from 'vitest';
import {
  regionForSite, canonicalCity, inferCorridor, corridorsForRegion, getRegion,
} from '@/lib/geo/regions';

const NCR_CORRIDORS = new Set(corridorsForRegion('ncr'));

// The corridor↔traffic-template contract (must match the shipped template files).
const CAVITE_CORRIDORS = ['Bacoor–Imus', 'Dasmariñas–General Trias', 'Tagaytay–Silang'];
const BATANGAS_CORRIDORS = ['Sto. Tomas–Tanauan', 'Lipa', 'Batangas City'];

interface Site { city: string; label: string; lat: number; lon: number }

const CAVITE_SITES: Array<Site & { expectCity: string; expectCorridor: string }> = [
  { city: 'Bacoor',           label: 'Molino Blvd',        lat: 14.4593, lon: 120.9366, expectCity: 'Bacoor',          expectCorridor: 'Bacoor–Imus' },
  { city: 'Imus',             label: 'Aguinaldo Hwy',      lat: 14.4297, lon: 120.9367, expectCity: 'Imus',            expectCorridor: 'Bacoor–Imus' },
  { city: 'Dasmariñas',       label: 'Pala-pala',          lat: 14.3294, lon: 120.9367, expectCity: 'Dasmariñas',      expectCorridor: 'Dasmariñas–General Trias' },
  { city: 'General Trias',    label: 'Gentri',             lat: 14.3869, lon: 120.8817, expectCity: 'General Trias',   expectCorridor: 'Dasmariñas–General Trias' },
  { city: 'Tagaytay',         label: 'Tagaytay Ridge',     lat: 14.1153, lon: 120.9621, expectCity: 'Tagaytay',        expectCorridor: 'Tagaytay–Silang' },
];

const BATANGAS_SITES: Array<Site & { expectCity: string; expectCorridor: string }> = [
  { city: 'Batangas City',    label: 'Diversion Rd',       lat: 13.7565, lon: 121.0583, expectCity: 'Batangas City',   expectCorridor: 'Batangas City' },
  { city: 'Lipa',             label: 'Ayala Hwy',          lat: 13.9411, lon: 121.1622, expectCity: 'Lipa',            expectCorridor: 'Lipa' },
  { city: 'Sto. Tomas',       label: 'SLEX exit',          lat: 14.1079, lon: 121.1416, expectCity: 'Sto. Tomas',      expectCorridor: 'Sto. Tomas–Tanauan' },
  { city: 'Tanauan',          label: 'Poblacion',          lat: 14.0863, lon: 121.1497, expectCity: 'Tanauan',         expectCorridor: 'Sto. Tomas–Tanauan' },
];

describe('R-08 — corridor↔template contract', () => {
  it('Cavite registry corridors == the traffic-template corridor set', () => {
    expect(corridorsForRegion('cavite')).toEqual(CAVITE_CORRIDORS);
  });
  it('Batangas registry corridors == the traffic-template corridor set', () => {
    expect(corridorsForRegion('batangas').sort()).toEqual([...BATANGAS_CORRIDORS].sort());
  });
});

describe('R-08 — Cavite site resolves entirely within Cavite (never NCR)', () => {
  it.each(CAVITE_SITES)('$city / $label', (s) => {
    // region
    expect(regionForSite(s)).toBe('cavite');
    // canonical LGU + region
    const canon = canonicalCity(s.city, s.label);
    expect(canon?.region).toBe('cavite');
    expect(canon?.city).toBe(s.expectCity);
    // corridor (drives both Lease Benchmark and Daypart seasonality)
    const corridor = inferCorridor(s.city, s.label);
    expect(corridor).toBe(s.expectCorridor);
    expect(NCR_CORRIDORS.has(corridor!)).toBe(false); // the anti-regression assertion
    // zonal region (Lease zonal cross-check + Land zoning) = IV-A, not NCR
    expect(getRegion(canon!.region)?.psaRegion).toBe('IV-A');
  });
});

describe('R-08 — Batangas site resolves entirely within Batangas (never NCR)', () => {
  it.each(BATANGAS_SITES)('$city / $label', (s) => {
    expect(regionForSite(s)).toBe('batangas');
    const canon = canonicalCity(s.city, s.label);
    expect(canon?.region).toBe('batangas');
    expect(canon?.city).toBe(s.expectCity);
    const corridor = inferCorridor(s.city, s.label);
    expect(corridor).toBe(s.expectCorridor);
    expect(NCR_CORRIDORS.has(corridor!)).toBe(false);
    expect(getRegion(canon!.region)?.psaRegion).toBe('IV-A');
  });
});

describe('R-08 — NCR is unaffected by the provincial wiring', () => {
  it('a Makati/BGC/Ortigas site still resolves to NCR corridors + region', () => {
    for (const [city, label, corridor] of [
      ['Makati', 'Ayala Ave', 'Makati CBD'],
      ['Taguig', 'BGC High Street', 'BGC'],
      ['Pasig', 'Ortigas Center', 'Ortigas'],
    ] as const) {
      expect(regionForSite({ city, label })).toBe('ncr');
      expect(inferCorridor(city, label)).toBe(corridor);
      expect(getRegion('ncr')?.psaRegion).toBe('NCR');
    }
  });
});
