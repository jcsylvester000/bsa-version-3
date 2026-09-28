/** Theme cookie parsing (Settings → Appearance): only known values reach <html data-theme>. */
import { describe, it, expect } from 'vitest';
import { parseTheme, DEFAULT_THEME } from '@/lib/ui/theme';

describe('parseTheme', () => {
  it('accepts the three themes', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('system')).toBe('system');
  });
  it('falls back to dark for missing or hostile values', () => {
    for (const v of [undefined, null, '', 'Light', 'light"><script>', 'solarized']) {
      expect(parseTheme(v as string | undefined)).toBe(DEFAULT_THEME);
    }
    expect(DEFAULT_THEME).toBe('dark');
  });
});
