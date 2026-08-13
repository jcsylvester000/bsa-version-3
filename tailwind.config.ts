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
        // Core Grid palette (retained)
        'nile-blue': '#193B4D',
        midnight: '#0E2430',
        muesli: '#A98B54',
        'burly-wood': '#DCB782',
        // --- Dark "Site Intelligence" theme (from the Visual Prototype mockups) ---
        ink: {
          bg: '#0b1426',        // page background (deep navy)
          panel: '#132241',     // card / panel surface
          'panel-2': '#0e192f', // alt panel / inset
          border: '#1d2c4d',    // hairline borders
          hover: '#1a2b52',     // hover surface
        },
        accent: {
          DEFAULT: '#e0a568',   // warm amber — primary accent / CTA
          soft: '#daae7d',
        },
        // Truth Layer semantic tokens — tuned for the dark theme
        verified: '#38a574',    // green — Verified
        assumed: '#d9a441',     // amber — Assumed
        projected: '#9b7bd4',   // violet — Projected
        // Verdict tokens (dark theme)
        go: '#38a574',
        caution: '#d9a441',
        nogo: '#d9534f',
        // Text
        'ink-text': '#e8ecf5',      // primary text on dark
        'ink-muted': '#8c96a8',     // secondary/muted text on dark
      },
      fontFamily: {
        // Poppins for headings, Calibri/Inter for body (brand system)
        heading: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['Calibri', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
