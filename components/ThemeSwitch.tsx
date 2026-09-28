'use client';

import { useState } from 'react';
import { THEME_COOKIE, type Theme } from '@/lib/ui/theme';

const OPTIONS: Array<{ value: Theme; label: string; help: string }> = [
  { value: 'dark', label: 'Dark', help: 'Easier on the eyes indoors and at night.' },
  { value: 'light', label: 'Light', help: 'Easier to read outdoors in the field.' },
  { value: 'system', label: 'Match device', help: 'Follows your phone or computer setting.' },
];

/**
 * Appearance switch (mockup G1). Applies the theme immediately on <html> and remembers it in the
 * `bsa-theme` cookie (1 year) so the server renders the same theme on the next page load.
 */
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);

  function choose(t: Theme) {
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    const secure = window.location.protocol === 'https:' ? '; secure' : '';
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax${secure}`;
  }

  return (
    <fieldset className="mt-4">
      <legend className="sr-only">Theme</legend>
      <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map((o) => {
          const active = theme === o.value;
          return (
            <label
              key={o.value}
              className={`focus-within:shadow-focus flex min-h-tap cursor-pointer flex-col gap-1 rounded-control border p-4 transition ${
                active ? 'border-accent bg-ink-hover' : 'border-ink-border-strong hover:bg-ink-hover'
              }`}
            >
              <span className="flex items-center gap-2 text-body font-semibold text-ink-text">
                <input
                  type="radio"
                  name="theme"
                  value={o.value}
                  checked={active}
                  onChange={() => choose(o.value)}
                  className="h-4 w-4 accent-[#BE8562]"
                />
                {o.label}
              </span>
              <span className="text-label font-normal text-ink-muted">{o.help}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
