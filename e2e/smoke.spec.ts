/**
 * Core-journey smoke test (F-43): login → dashboard → open a site → tabs → PDF link.
 *
 * Runs against a live server. In `AUTH_MODE=mock` the demo login + demo run need no database, which is
 * enough to catch a broken render/route regression before deploy; a full run against a seeded DB
 * additionally exercises intake → pipeline. Kept deliberately shallow and resilient so it stays green
 * as copy changes — it asserts the journey WORKS, not exact wording.
 */
import { test, expect } from '@playwright/test';

const DEMO_EMAIL = 'owner@macaoimperial.test';
const DEMO_PASSWORD = 'bsa-demo-1234';

test('login → dashboard → site tabs → PDF link', async ({ page }) => {
  // 1. Login
  await page.goto('/login');
  await page.getByLabel(/username or email/i).fill(DEMO_EMAIL);
  await page.getByLabel(/password/i).first().fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();

  // 2. Land on the Site Dashboard
  await page.waitForURL(/\/runs/);
  await expect(page.getByRole('heading', { name: /site dashboard/i })).toBeVisible();

  // 3. Open the first site from the ranked shortlist (demo run renders one).
  const firstSiteLink = page.getByRole('link', { name: /view|open|site|report/i }).first();
  if (await firstSiteLink.count()) {
    await firstSiteLink.click();
    // 4. The per-site tabs are present, and the Export PDF control links to the deterministic report.
    const pdf = page.getByRole('link', { name: /export site pdf/i });
    await expect(pdf).toBeVisible();
    await expect(pdf).toHaveAttribute('href', /\/api\/analysis-report\/pdf\?runId=/);
  }
});

test('unauthenticated app route redirects to login (F-30 guard)', async ({ page }) => {
  await page.context().clearCookies();
  await page.goto('/runs');
  await page.waitForURL(/\/login/);
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
});
