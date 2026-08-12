/**
 * Window boundaries derived from the restaurant-local "today", not host/UTC
 * `new Date()`. `endStr` is today's date in `tz`; `startStr` is `weeks` weeks
 * earlier. Dates are plain YYYY-MM-DD (no time component), matching
 * `unified_sales.sale_date`'s column type.
 *
 * Shared by `useSplhData` (scheduling SPLH) and `useLaborSalesAnalytics`
 * (Labor P&L). Both must resolve the exact same window, so this helper is the
 * single source of truth. Do not inline a second copy.
 */
export function localWindow(tz: string, weeks: number): { startStr: string; endStr: string } {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const endStr = fmt.format(now); // YYYY-MM-DD in tz (en-CA locale formats this way)
  const [y, m, d] = endStr.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  start.setUTCDate(start.getUTCDate() - weeks * 7);
  return { startStr: start.toISOString().slice(0, 10), endStr };
}
