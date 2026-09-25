import type { Config } from 'tailwindcss';

/**
 * Grid Property Ventures brand system — BSA v2.
 * Semantic colours resolve through CSS variables (app/globals.css) so every existing class
 * (bg-ink-panel, text-ink-muted, bg-go/15 …) works in both themes. Light theme = data-theme="light" on <html>.
 */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // --- Official GRID Property Ventures brand palette (unchanged) ---
        'nile-blue': '#1C335E',
        midnight: '#0E192F',
        muesli: '#BE8562',
        'deep-code': '#141545',
        'burly-wood': '#E2B985',
        iron: '#D2D2D2',
        // --- Semantic surfaces (theme-aware) ---
        ink: {
          bg: v('bg'),
          panel: v('panel'),
          'panel-2': v('panel-2'),
          border: v('border'),
          'border-strong': v('border-strong'),
          hover: v('hover'),
        },
        'ink-text': v('text'),
        'ink-muted': v('text-muted'),
        'ink-heading': v('heading'),
        accent: {
          DEFAULT: '#BE8562', // Muesli — FILLS ONLY (buttons, active tab underline). Never body text on cards.
          soft: '#E2B985', // Burly Wood
          text: v('accent-text'), // links / accent text (Burly Wood dark, deep Muesli light)
          on: '#0E192F', // text on Muesli — 5.61:1
          hover: '#CB9573',
        },
        // --- Functional: verdicts + Truth Layer (distinct from brand accents) ---
        go: v('go'),
        caution: v('caution'),
        nogo: v('nogo'),
        verified: v('go'),
        assumed: v('caution'),
        projected: v('projected'),
        'on-status': v('on-status'), // text on solid verdict fills
        focus: v('focus'),
      },
      fontFamily: {
        heading: ['"Cantata One"', 'Judson', 'Georgia', 'serif'],
        body: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Judson', 'Georgia', 'serif'],
      },
      fontSize: {
        overline: ['0.8125rem', { lineHeight: '1rem', letterSpacing: '0.08em', fontWeight: '600' }],
        chip: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.06em', fontWeight: '600' }],
        label: ['0.875rem', { lineHeight: '1.25rem', fontWeight: '500' }],
        body: ['1rem', { lineHeight: '1.625rem' }],
        'body-lg': ['1.125rem', { lineHeight: '1.75rem' }],
        title: ['1.125rem', { lineHeight: '1.75rem', fontWeight: '600' }],
        stat: ['2rem', { lineHeight: '2.25rem', fontWeight: '600' }],
        rationale: ['1.625rem', { lineHeight: '2.35rem' }],
        h3: ['1.25rem', { lineHeight: '1.75rem' }],
        h2: ['1.5rem', { lineHeight: '2rem' }],
        h1: ['2.25rem', { lineHeight: '2.6rem' }],
        display: ['2.75rem', { lineHeight: '3rem', letterSpacing: '-0.01em' }],
      },
      borderRadius: {
        chip: '4px',
        control: '10px',
        card: '14px',
        hero: '16px',
        modal: '20px',
      },
      boxShadow: {
        e1: '0 1px 2px rgb(0 0 0 / .35), inset 0 1px 0 rgb(255 255 255 / .05)',
        e2: '0 8px 24px rgb(0 0 0 / .40)',
        e3: '0 24px 64px rgb(0 0 0 / .55)',
        focus: '0 0 0 2px rgb(var(--panel)), 0 0 0 4px rgb(var(--focus))',
      },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
    },
  },
  plugins: [],
};

export default config;
