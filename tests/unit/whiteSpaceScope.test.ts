/**
 * F-11 / F-20 regression guard: White-Space must scope every geographic read to a local radius
 * around the proposed site. If any of these reads loses its ST_DWithin scope, the scan reverts to
 * loading the whole country (slow, and can recommend areas in another region).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = readFileSync(join(__dirname, '..', '..', 'lib', 'modules', 'p2p3Modules.ts'), 'utf8');
// Just the runWhiteSpace function body.
const start = src.indexOf('export async function runWhiteSpace');
const body = src.slice(start);

describe('White-Space local scoping', () => {
  it('reads competitor POIs scoped by distance, not the whole poi table', () => {
    // The unscoped competitor read was: SELECT name, lat, lon FROM poi WHERE category = 'competitor'
    const poiRead = body.match(/SELECT name, lat, lon\s+FROM poi[\s\S]*?ST_DWithin/);
    expect(poiRead, 'competitor POI read must include ST_DWithin').not.toBeNull();
  });

  it('reads demographic candidate areas scoped by distance', () => {
    const demoRead = body.match(/FROM demographic_cell d\s+WHERE[\s\S]*?ST_DWithin\(d\.geom/);
    expect(demoRead, 'demographic_cell read must include ST_DWithin').not.toBeNull();
  });

  it('scopes the POI-fallback cluster read too', () => {
    const clusterRead = body.match(/GROUP BY COALESCE\(NULLIF\(TRIM\(barangay\)/);
    const clusterBlock = body.slice(0, clusterRead?.index ?? 0);
    expect(clusterBlock.includes('ST_DWithin(geom')).toBe(true);
  });

  it('scopes own outlets to the scan radius', () => {
    const outletRead = body.match(/SELECT lat, lon FROM outlet[\s\S]*?ST_DWithin/);
    expect(outletRead, 'outlet read must include ST_DWithin').not.toBeNull();
  });

  it('defines a finite scan radius', () => {
    expect(src).toMatch(/WHITESPACE_SCAN_RADIUS_M\s*=\s*15_000/);
  });
});
