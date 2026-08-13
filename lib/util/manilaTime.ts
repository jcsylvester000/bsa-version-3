/**
 * ICU-safe Manila (Asia/Manila, UTC+8, no DST) time formatting.
 *
 * WHY THIS EXISTS: Netlify's serverless runtime (AWS Lambda) can ship a Node build
 * WITHOUT full ICU timezone data. Calling `Intl.DateTimeFormat(..., { timeZone:
 * 'Asia/Manila' })` there throws `RangeError: Invalid time zone specified` — which
 * is exactly what 500'd POST /api/intake in production while working locally (dev
 * machines have full ICU). The Philippines has a fixed +08:00 offset and no DST, so
 * we compute Manila wall-clock by shifting the UTC epoch by 8h and formatting the
 * pieces manually — no timezone database required, works on any runtime.
 */
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function manilaParts(d: Date) {
  const m = new Date(d.getTime() + MANILA_OFFSET_MS);
  // Use UTC getters on the shifted date → these ARE Manila wall-clock values.
  const year = m.getUTCFullYear();
  const monthIdx = m.getUTCMonth();
  const day = m.getUTCDate();
  let h = m.getUTCHours();
  const min = m.getUTCMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return { year, monthIdx, day, h, min, ampm };
}

/** "Aug 3, 3:24 PM" — the run-name stamp. */
export function manilaShortStamp(d: Date = new Date()): string {
  const p = manilaParts(d);
  const mm = String(p.min).padStart(2, '0');
  return `${MONTHS[p.monthIdx]} ${p.day}, ${p.h}:${mm} ${p.ampm}`;
}

/** "August 3, 2026 at 3:24 PM" — the report "generated" line. */
export function manilaLongStamp(d: Date = new Date()): string {
  const p = manilaParts(d);
  const mm = String(p.min).padStart(2, '0');
  return `${MONTHS_LONG[p.monthIdx]} ${p.day}, ${p.year} at ${p.h}:${mm} ${p.ampm}`;
}
