/**
 * Pure mapping from a brand-supplied outlet list (CSV record) to an outlet row (Brief alignment T-5).
 * Tolerant of common column names. No I/O — unit-tested in tests/unit/outletRow.test.ts.
 */

export interface OutletListRow {
  outletName: string;
  lat: number;
  lon: number;
  format: string | null;
  status: 'open' | 'closed' | 'renovating';
  monthlySalesPhp: number | null;
}

const KEYS = {
  name: ['outlet_name', 'outletName', 'name', 'branch', 'branch_name', 'store', 'store_name'],
  lat: ['lat', 'latitude', 'Lat', 'Latitude', 'y'],
  lon: ['lon', 'lng', 'long', 'longitude', 'Lon', 'Longitude', 'x'],
  format: ['format', 'store_format', 'type'],
  status: ['status', 'state'],
  sales: ['monthly_sales_php', 'monthly_sales', 'sales', 'avg_monthly_sales'],
};

function pick(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (v != null && `${v}`.trim() !== '') return `${v}`.trim();
  }
  return null;
}

const FORMATS = new Set(['kiosk', 'inline', 'mall', 'freestanding', 'cart', 'drive_thru']);

/** One record → row, or a reason it was skipped. Coordinates must sit inside the Philippines. */
export function outletRowFrom(rec: Record<string, unknown>): { row: OutletListRow } | { skip: string } {
  const outletName = pick(rec, KEYS.name);
  if (!outletName) return { skip: 'no name' };
  const latS = pick(rec, KEYS.lat), lonS = pick(rec, KEYS.lon);
  const lat = latS == null ? NaN : Number(latS);
  const lon = lonS == null ? NaN : Number(lonS);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return { skip: `${outletName}: no coordinates` };
  if (lat < 4.2 || lat > 21.5 || lon < 116 || lon > 127.2) return { skip: `${outletName}: coordinates outside the Philippines` };
  const f = pick(rec, KEYS.format)?.toLowerCase().replace(/[\s-]+/g, '_') ?? null;
  const st = pick(rec, KEYS.status)?.toLowerCase() ?? 'open';
  // Planned / coming-soon branches are not open yet, so they never count in overlap.
  if (st.startsWith('plan') || st.includes('soon')) return { skip: `${outletName}: not open yet (planned)` };
  const status = st.startsWith('clos') ? 'closed' : st.startsWith('renov') ? 'renovating' : 'open';
  const salesRaw = pick(rec, KEYS.sales);
  const sales = salesRaw != null ? Number(salesRaw.replace(/[₱,\s]/g, '')) : NaN;
  return {
    row: {
      outletName, lat, lon,
      format: f && FORMATS.has(f) ? f : null,
      status,
      monthlySalesPhp: Number.isFinite(sales) && sales > 0 ? Math.round(sales) : null,
    },
  };
}
