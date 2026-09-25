import type { Config } from 'tailwindcss';

/**
 * Grid Property Ventures brand system.
 * Colours and type are exposed as tokens so components never hard-code hex values
 * (Senior Engineer standard: "Grid brand tokens, not hard-coded colours").
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // --- Official GRID Property Ventures brand palette ---
        'nile-blue': '#1C335E',   // primary
        midnight: '#0E192F',      // primary (darkest)
        muesli: '#BE8562',        // primary accent (warm tan)
        'deep-code': '#141545',   // secondary (deep indigo)
        'burly-wood': '#E2B985',  // secondary (light tan)
        iron: '#D2D2D2',          // secondary (neutral)
        // --- Dark theme mapped onto the brand palette ---
        ink: {
          bg: '#0E192F',        // Midnight — page background
          panel: '#1C335E',     // Nile Blue — card / panel surface
          'panel-2': '#15254A', // deeper navy — inset / alt panel
          border: '#2A4372',    // hairline borders (navy)
          hover: '#254069',     // hover surface
        },
        accent: {
          DEFAULT: '#BE8562',   // Muesli — primary accent / CTA
          soft: '#E2B985',      // Burly Wood
        },
        // Truth Layer semantic tokens (functional status colours, not brand palette)
        verified: '#3EAF7F',    // green — Verified
        assumed: '#D9A441',     // amber — Assumed
        projected: '#9B7BD4',   // violet — Projected
        // Verdict tokens
        go: '#3EAF7F',
        caution: '#D9A441',
        nogo: '#D9534F',
        // Text (on the dark navy surfaces)
        'ink-text': '#EDF2FB',      // near-white primary text
        'ink-muted': '#94A3BE',     // muted blue-grey secondary text
      },
      fontFamily: {
        // Brand system: Cantata One for headings, Poppins for body, Judson as the serif accent.
        heading: ['"Cantata One"', 'Judson', 'Georgia', 'serif'],
        body: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Judson', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};

export default config;
