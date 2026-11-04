// supabase/functions/_shared/financialAggregates.ts
// One net-sales definition for every AI financial tool.
// Net sales = gross_revenue - discounts - refunds (see the spec, §5.1).

export interface MonthlyMetricsRow {
  period: string; gross_revenue: number; sales_tax: number; tips: number;
  other_liabilities: number; discounts: number; refunds: number;
}
export interface NetSalesTotals {
  gross: number; discounts: number; refunds: number;
  salesTax: number; tips: number; otherLiabilities: number; net: number;
}
const n = (v: number | null | undefined) => Number(v ?? 0);

export function sumMonthlyMetrics(rows: MonthlyMetricsRow[] | null): NetSalesTotals {
  const t = { gross: 0, discounts: 0, refunds: 0, salesTax: 0, tips: 0, otherLiabilities: 0, net: 0 };
  for (const r of rows ?? []) {
    t.gross += n(r.gross_revenue); t.discounts += n(r.discounts); t.refunds += n(r.refunds);
    t.salesTax += n(r.sales_tax); t.tips += n(r.tips); t.otherLiabilities += n(r.other_liabilities);
  }
  t.net = t.gross - t.discounts - t.refunds;
  return t;
}

export async function fetchNetSales(
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> },
  restaurantId: string, startDate: string, endDate: string,
): Promise<NetSalesTotals> {
  const { data, error } = await supabase.rpc('get_monthly_sales_metrics', {
    p_restaurant_id: restaurantId, p_date_from: startDate, p_date_to: endDate,
  });
  if (error) throw new Error(`get_monthly_sales_metrics failed: ${error.message}`);
  return sumMonthlyMetrics(data as MonthlyMetricsRow[] | null);
}

export function sumMonthlyFoodCost(rows: { period: string; food_cost: number }[] | null): number {
  return (rows ?? []).reduce((s, r) => s + n(r.food_cost), 0);
}
