import { manilaShortStamp, manilaLongStamp } from './lib/util/manilaTime';
// A known UTC instant: 2026-08-03T07:24:00Z → Manila (+8) = 2026-08-03 15:24 → "Aug 3, 3:24 PM"
const d = new Date('2026-08-03T07:24:00Z');
console.log('short:', manilaShortStamp(d), '   (expect: Aug 3, 3:24 PM)');
console.log('long :', manilaLongStamp(d), '   (expect: August 3, 2026 at 3:24 PM)');
// midnight rollover: 2026-08-03T16:05:00Z → Manila 2026-08-04 00:05 → "Aug 4, 12:05 AM"
const d2 = new Date('2026-08-03T16:05:00Z');
console.log('short:', manilaShortStamp(d2), '   (expect: Aug 4, 12:05 AM)');
// noon: 2026-12-25T04:00:00Z → Manila 12:00 PM Dec 25
const d3 = new Date('2026-12-25T04:00:00Z');
console.log('short:', manilaShortStamp(d3), '   (expect: Dec 25, 12:00 PM)');
// cross-check against ICU (local has full ICU)
const icu = new Intl.DateTimeFormat('en-PH', { timeZone:'Asia/Manila', month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }).format(d);
console.log('ICU short for d:', icu);
