/**
 * Netlify Scheduled Function — works the automated POI back-fill queue every 10 minutes.
 * It only calls the app's own internal endpoint with the shared CRON_SECRET; all logic, guard
 * rails (switch, daily cap, OpenStreetMap status) and data writes live in lib/services/autofill.ts.
 * Set CRON_SECRET (≥ 32 random chars) in the Netlify site env. AUTOFILL_ENABLED=0 pauses it.
 */
export default async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) {
    console.log('[autofill-cron] skipped: URL or CRON_SECRET not set');
    return new Response('skipped', { status: 200 });
  }
  const res = await fetch(`${base}/api/internal/autofill`, { method: 'POST', headers: { authorization: `Bearer ${secret}` } });
  const text = await res.text();
  console.log(`[autofill-cron] ${res.status} ${text.slice(0, 500)}`);
  return new Response('ok', { status: 200 });
};

export const config = { schedule: '*/10 * * * *' };
