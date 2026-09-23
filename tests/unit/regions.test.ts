/**
 * R-01 — region registry + resolvers. Confirms the NCR/Davao behaviour is unchanged after the
 * refactor and the new Cavite/Batangas support resolves correctly.
 */
import { describe, it, expect } from 'vitest';
import {
  getRegion, listRegions, REGION_KEYS, regionForPoint, regionForSite,
  canonicalCity, inferCorridor, corridorsForRegion,
} from '@/lib/geo/regions';
import { canonicalNcrCity } from '@/lib/modules/leaseMath';

describe('registry', () => {
  it('registers ncr, davao, cavite, batangas', () => {
    expect(REGION_KEYS.sort()).toEqual(['batangas', 'cavite', 'davao', 'ncr']);
    expect(listRegions()).toHaveLength(4);
    expect(getRegion('cavite')?.name).toBe('Cavite');
    expect(getRegion('nope')).toBeNull();
  });
});

describe('inferCorridor — NCR/Davao behaviour preserved', () => {
  const cases: Array<[string | null, string, string]> = [
    ['Taguig', 'BGC High Street', 'BGC'],
    ['Makati', 'Ayala Ave', 'Makati CBD'],
    ['Pasig', 'Ortigas Center', 'Ortigas'],
    ['Quezon City', 'Cubao Araneta', 'Quezon City'],
    ['Pasay', 'MOA Complex', 'Pasay Bay Area'],
    [null, 'SM Mall of Asia', 'Pasay Bay Area'],
    ['Mandaluyong', 'SM Megamall', 'Mandaluyong'],
    ['Davao City', 'Lanang', 'Davao City'],
  ];
  it.each(cases)('%s / %s → %s', (city, label, corridor) => {
    expect(inferCorridor(city, label)).toBe(corridor);
  });
  it('an unknown/foreign city yields null (caller falls back to a default corridor)', () => {
    expect(inferCorridor('Cebu City', 'Ayala Center Cebu')).toBeNull();
  });
});

describe('inferCorridor — provincial corridors (R-06), region-first', () => {
  it('a Cavite site hits its own corridor instead of the border NCR corridor', () => {
    // Pre-R-06 this returned NCR "Las Piñas" (a border-town token); now region-first picks Cavite.
    expect(inferCorridor('Bacoor', 'Molino Blvd')).toBe('Bacoor–Imus');
    expect(inferCorridor('Imus', 'Bayan')).toBe('Bacoor–Imus');
    expect(inferCorridor('General Trias', 'Gentri')).toBe('Dasmariñas–General Trias');
    expect(inferCorridor('Tagaytay', 'Ridge')).toBe('Tagaytay–Silang');
  });
  it('a Batangas site resolves its corridor', () => {
    expect(inferCorridor('Lipa City', 'Ayala Highway')).toBe('Lipa');
    expect(inferCorridor('Sto. Tomas', 'SLEX')).toBe('Sto. Tomas–Tanauan');
    expect(inferCorridor('Batangas City', 'Poblacion')).toBe('Batangas City');
  });
  it('a shared-token NCR site is unchanged (Zapote → NCR Las Piñas)', () => {
    expect(inferCorridor('Zapote', 'Las Piñas')).toBe('Las Piñas');
  });
});

describe('canonicalNcrCity — unchanged', () => {
  it('resolves NCR LGUs', () => {
    expect(canonicalNcrCity('City of Pasig', 'Ortigas')).toBe('Pasig');
    expect(canonicalNcrCity('Taguig', 'BGC')).toBe('Taguig');
    expect(canonicalNcrCity(null, 'Cubao')).toBe('Quezon City');
  });
  it('returns null for a non-NCR LGU', () => {
    expect(canonicalNcrCity('Bacoor', 'Cavite')).toBeNull();
    expect(canonicalNcrCity('Lipa', 'Batangas')).toBeNull();
  });
});

describe('canonicalCity — region-aware', () => {
  it('tags NCR', () => {
    expect(canonicalCity('City of Pasig')).toEqual({ region: 'ncr', city: 'Pasig' });
  });
  it('tags Cavite LGUs', () => {
    expect(canonicalCity('Bacoor')).toEqual({ region: 'cavite', city: 'Bacoor' });
    expect(canonicalCity('Dasmariñas City')).toEqual({ region: 'cavite', city: 'Dasmariñas' });
    expect(canonicalCity(null, 'Proposed — Imus Bypass')).toEqual({ region: 'cavite', city: 'Imus' });
  });
  it('tags Batangas LGUs', () => {
    expect(canonicalCity('Lipa City')).toEqual({ region: 'batangas', city: 'Lipa' });
    expect(canonicalCity('Batangas City')).toEqual({ region: 'batangas', city: 'Batangas City' });
  });
  it('NCR wins a shared token (zapote → Las Piñas, NCR)', () => {
    expect(canonicalCity('Zapote')).toEqual({ region: 'ncr', city: 'Las Piñas' });
  });
});

describe('regionForPoint', () => {
  it('boxes NCR and Davao', () => {
    expect(regionForPoint(14.55, 121.02)).toBe('ncr'); // Makati
    expect(regionForPoint(7.06, 125.61)).toBe('davao'); // Davao downtown
  });
  it('boxes Batangas and (western) Cavite', () => {
    expect(regionForPoint(13.76, 121.06)).toBe('batangas'); // Batangas City
    expect(regionForPoint(14.20, 120.70)).toBe('cavite'); // west Cavite, clear of the NCR box
  });
  it('null outside every box', () => {
    expect(regionForPoint(10.3, 123.9)).toBeNull(); // Cebu
    expect(regionForPoint(null, null)).toBeNull();
  });
});

describe('regionForSite — LGU name wins over the coarse box', () => {
  it('a Bacoor pin near the NCR/Cavite border resolves to Cavite by its LGU name', () => {
    // Coordinate alone (inside the NCR box) would say NCR; the city name corrects it.
    expect(regionForSite({ city: 'Bacoor', lat: 14.46, lon: 120.96 })).toBe('cavite');
  });
  it('falls back to the coordinate when the LGU is unknown', () => {
    expect(regionForSite({ city: '', label: 'unnamed', lat: 13.76, lon: 121.06 })).toBe('batangas');
  });
});

describe('corridorsForRegion', () => {
  it('lists NCR and (R-06) provincial corridors', () => {
    expect(corridorsForRegion('ncr')).toContain('BGC');
    expect(corridorsForRegion('cavite')).toEqual(['Bacoor–Imus', 'Dasmariñas–General Trias', 'Tagaytay–Silang']);
    expect(corridorsForRegion('batangas')).toContain('Lipa');
  });
});
