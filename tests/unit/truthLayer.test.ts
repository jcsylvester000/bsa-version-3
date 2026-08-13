import { describe, it, expect } from 'vitest';
import { rollUpConfidence, downgrade } from '@/lib/truth/truthLayer';

describe('rollUpConfidence', () => {
  it('returns low for an empty set', () => {
    expect(rollUpConfidence([])).toBe('low');
  });

  it('returns high when mostly verified', () => {
    expect(rollUpConfidence(['verified', 'verified', 'verified', 'assumed'])).toBe('high');
  });

  it('returns low when a third or more is projected', () => {
    expect(rollUpConfidence(['verified', 'projected', 'projected'])).toBe('low');
  });

  it('returns med for a balanced mix', () => {
    expect(rollUpConfidence(['verified', 'assumed', 'assumed'])).toBe('med');
  });

  it('downgrades one band when an on-ground check is flagged', () => {
    const withoutFlag = rollUpConfidence(['verified', 'verified', 'verified']);
    const withFlag = rollUpConfidence(['verified', 'verified', 'verified'], { onGroundCheckFlagged: true });
    expect(withoutFlag).toBe('high');
    expect(withFlag).toBe('med');
  });
});

describe('downgrade', () => {
  it('steps down one band and floors at low', () => {
    expect(downgrade('high')).toBe('med');
    expect(downgrade('med')).toBe('low');
    expect(downgrade('low')).toBe('low');
  });
});
