/**
 * Pure helpers for deriving hour and day-of-week from a unified_sales row.
 * No Deno-specific imports — importable by both Deno edge functions and Vitest.
 */

export interface SaleRow {
  sale_date?: string | null;
  sale_time?: string | null;
  sold_at?: string | null;
  total_price?: number | null;
}

/**
 * Module-level cache: reuse Intl.DateTimeFormat instances across rows.
 * Keyed by IANA timezone string. Constructing an ICU formatter is expensive;
 * caching eliminates per-row allocation when processing large result sets.
 */
const _fmtCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = _fmtCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    });
    _fmtCache.set(timeZone, fmt);
  }
  return fmt;
}

/**
 * Returns the local hour (0-23) for a sale, preferring `sold_at` (timezone-aware)
 * over `sale_time` (legacy local parse). Returns -1 when no time data is available.
 *
 * @param sale     Row from unified_sales
 * @param timeZone IANA timezone string, e.g. 'America/Chicago'
 */
export function hourFromSale(sale: SaleRow, timeZone: string): number {
  if (sale.sold_at) {
    const formatted = getFormatter(timeZone).format(new Date(sale.sold_at));
    const h = parseInt(formatted, 10);
    if (!isNaN(h) && h >= 0 && h <= 23) return h;
  }
  if (sale.sale_time) {
    const h = parseInt(sale.sale_time.split(":")[0], 10);
    if (!isNaN(h) && h >= 0 && h <= 23) return h;
  }
  return -1;
}

/**
 * Returns the day of week (0=Sunday … 6=Saturday) for a YYYY-MM-DD string,
 * using a noon-anchored parse to prevent UTC-midnight day-shift for timezones
 * west of UTC (e.g. America/Chicago).
 */
export function dayOfWeekFromSaleDate(saleDate: string): number {
  return new Date(saleDate + "T12:00:00").getDay();
}
