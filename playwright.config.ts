/**
 * Playwright E2E config (F-43). Smoke-tests the core journey against a REAL running app + database.
 * Not part of `npm test` (which is the fast, DB-free Vitest unit suite) — run it in CI or locally
 * once a database is available:
 *
 *   npm run build && npm run start &     # or `npm run dev`
 *   AUTH_MODE=mock npx playwright test   # mock login needs no DB; a full run uses a seeded DB
 *
 * Install once: `npm i -D @playwright/test && npx playwright install chromium`.
 */
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
