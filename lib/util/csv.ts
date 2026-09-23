/**
 * Minimal RFC-4180-ish CSV parser (pure, no dependency). Handles quoted fields, embedded
 * commas/newlines and doubled quotes. Returns an array of records keyed by the header row.
 * Good enough for the reference-data CSVs BSA loads (PSA/HDX exports). Unit-tested.
 */

/** Parse CSV text into rows of string cells. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, '\n'); // normalise line endings
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); cell = '';
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  // flush trailing cell/row (unless the file ended on a newline with nothing after)
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** Parse CSV text into objects keyed by the header row (trimmed). Blank rows are skipped. */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows = parseCsvRows(text).filter((r) => r.some((c) => c.trim() !== ''));
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = (r[i] ?? '').trim(); });
    return rec;
  });
}
