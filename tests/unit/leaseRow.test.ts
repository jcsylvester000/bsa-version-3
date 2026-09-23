/**
 * R-06 — lease-comp CSV row mapping (tolerant columns, corridor canonicalisation, format
 * normalisation, no-fabrication drop rule).
 */
import { describe, it, expect } from 'vitest';
import { leaseRowFrom, canonicalCorridor, canonicalFormat } from '@/lib/geo/leaseRow';

describe('canonicalFormat', () => {
  it('normalises to the four known formats, defaulting to inline', () => {
    expect(canonicalFormat('Inline')).toBe('inline');
    expect(canonicalFormat('Mall GLA')).toBe('mall');
    expect(canonicalFormat('high street')).toBe('highstreet');
    expect(canonicalFormat('pushcart')).toBe('kiosk');
    expect(canonicalFormat('whatever')).toBe('inline');
    expect(canonicalFormat(null)).toBe('inline');
  });
});

describe('canonicalCorridor', () => {
  it('maps a town/barangay to its Cavite corridor', () => {
    expect(canonicalCorridor('Molino', 'cavite')).toBe('Bacoor–Imus');
    expect(canonicalCorridor('Imus', 'cavite')).toBe('Bacoor–Imus');
    expect(canonicalCorridor('General Trias', 'cavite')).toBe('Dasmariñas–General Trias');
    expect(canonicalCorridor('Tagaytay', 'cavite')).toBe('Tagaytay–Silang');
  });
  it('maps a Batangas town to its corridor', () => {
    expect(canonicalCorridor('Sto. Tomas', 'batangas')).toBe('Sto. Tomas–Tanauan');
    expect(canonicalCorridor('Lipa City', 'batangas')).toBe('Lipa');
  });
  it('accepts the corridor name itself', () => {
    expect(canonicalCorridor('Bacoor–Imus', 'cavite')).toBe('Bacoor–Imus');
  });
  it('keeps an unknown corridor verbatim so it still loads', () => {
    expect(canonicalCorridor('Some New Growth Area', 'cavite')).toBe('Some New Growth Area');
  });
});

describe('leaseRowFrom', () => {
  it('maps a full Cavite comp, canonicalising corridor + format and stripping ₱/commas', () => {
    const r = leaseRowFrom(
      { area: 'Molino', type: 'Inline', base_rent_php_sqm: '₱1,050', escalation_pct: '5', cusa_php_sqm: '140', lease_term_years: '5', fitout_months: '2', observed_date: '2026-06-10', truth_layer: 'assumed', source: 'Lamudi asking' },
      'cavite',
    );
    expect(r).toMatchObject({
      corridor: 'Bacoor–Imus', format: 'inline', base_rent_php_sqm: 1050, escalation_pct: 5,
      cusa_php_sqm: 140, lease_term_years: 5, fitout_months: 2, truth_layer: 'assumed',
    });
  });

  it('defaults truth_layer to assumed and format to inline', () => {
    const r = leaseRowFrom({ corridor: 'Lipa', rent: '800' }, 'batangas');
    expect(r?.truth_layer).toBe('assumed');
    expect(r?.format).toBe('inline');
    expect(r?.base_rent_php_sqm).toBe(800);
  });

  it('keeps a published band as verified and carries the mall name', () => {
    const r = leaseRowFrom({ corridor: 'Dasmariñas–General Trias', format: 'mall', mall_name: 'Vista Mall Dasma', base_rent_php_sqm: '1400', truth_layer: 'verified' }, 'cavite');
    expect(r?.truth_layer).toBe('verified');
    expect(r?.mall_name).toBe('Vista Mall Dasma');
    expect(r?.format).toBe('mall');
  });

  it('drops a row with no corridor, or with no numeric term (never fabricates a comp)', () => {
    expect(leaseRowFrom({ format: 'inline', base_rent_php_sqm: '900' }, 'cavite')).toBeNull();
    expect(leaseRowFrom({ corridor: 'Lipa', format: 'inline' }, 'batangas')).toBeNull();
  });
});
