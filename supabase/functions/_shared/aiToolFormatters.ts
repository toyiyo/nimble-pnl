// supabase/functions/_shared/aiToolFormatters.ts
// Pure helpers that shape ai-execute-tool results for the model.
// No Deno imports, so Vitest can import this file.

/**
 * Columns for the batch_categorize_pos_sales preview. unified_sales has
 * pos_system, not source (20250925125415 migration).
 */
export const POS_SALE_PREVIEW_COLUMNS = 'id, item_name, total_price, sale_date, pos_system';

type Numeric = number | string | null | undefined;
const num = (v: Numeric): number => Number(v ?? 0);

export interface TopSoldItemRow {
  item_name: string;
  revenue: Numeric;
  quantity: Numeric;
  sale_count: Numeric;
}

export interface TopSoldItem {
  item_name: string;
  /** Units sold (sum of quantity). */
  quantity_sold: number;
  /** Number of sale lines. */
  line_count: number;
  total_sales: number;
  /** Revenue per unit. */
  avg_price: number;
}

/** Map get_top_sold_items rows. Units come from quantity, not from the row count. */
export function mapTopSoldItems(rows: TopSoldItemRow[] | null): TopSoldItem[] {
  return (rows ?? []).map((row) => {
    const quantity = num(row.quantity);
    const revenue = num(row.revenue);
    return {
      item_name: row.item_name,
      quantity_sold: quantity,
      line_count: num(row.sale_count),
      total_sales: revenue,
      avg_price: quantity > 0 ? revenue / quantity : 0,
    };
  });
}

export interface CashFlowDay {
  inflow: Numeric;
  outflow: Numeric;
  net: Numeric;
}

export interface CashFlowSummary {
  inflows: number;
  outflows: number;
  net_cash_flow: number;
  /** Days in the requested period, end day included. */
  period_days: number;
  avg_daily_cash_flow: number;
  /** Standard deviation of the daily net flow. */
  volatility: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Count the days from start to end (YYYY-MM-DD), both days included. */
function inclusiveDays(startDate: string, endDate: string): number {
  const start = Date.parse(`${startDate.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 0;
  return Math.round((end - start) / MS_PER_DAY) + 1;
}

/** Totals for the whole requested period. The keys have no "_7d" suffix. */
export function buildCashFlowSummary(
  days: CashFlowDay[] | null,
  startDate: string,
  endDate: string
): CashFlowSummary {
  const rows = days ?? [];
  const inflows = rows.reduce((sum, d) => sum + num(d.inflow), 0);
  const outflows = rows.reduce((sum, d) => sum + num(d.outflow), 0);
  const netCashFlow = inflows - outflows;
  const periodDays = inclusiveDays(startDate, endDate);

  const nets = rows.map((d) => num(d.net));
  const mean = nets.reduce((sum, v) => sum + v, 0) / (nets.length || 1);
  const variance = nets.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (nets.length || 1);

  return {
    inflows,
    outflows,
    net_cash_flow: netCashFlow,
    period_days: periodDays,
    avg_daily_cash_flow: periodDays > 0 ? netCashFlow / periodDays : 0,
    volatility: Math.sqrt(variance),
  };
}

export interface CashCoverage {
  /** Cash balance / labor cost. Null when the period has no labor cost. */
  multiplier: number | null;
  status: 'good' | 'caution' | 'critical' | 'not_applicable';
  alert: string | null;
}

/** Cash coverage before payroll. With no labor cost, the ratio has no meaning. */
export function computeCashCoverage(cashBalance: number, laborCost: number): CashCoverage {
  if (!(laborCost > 0)) {
    return { multiplier: null, status: 'not_applicable', alert: null };
  }
  const multiplier = cashBalance / laborCost;
  if (multiplier >= 2) return { multiplier, status: 'good', alert: null };
  if (multiplier >= 1.5) return { multiplier, status: 'caution', alert: null };
  return {
    multiplier,
    status: 'critical',
    alert: `Cash coverage before payroll is only ${multiplier.toFixed(1)}x`,
  };
}

export interface PnlBasis {
  revenue: string;
  cogs: string;
  expenses: string;
  closest_ui_view: string;
  differences: string;
}

/** Sources of the get_financial_statement income statement figures. */
export function incomeStatementBasis(): PnlBasis {
  return {
    revenue: 'POS net sales (get_monthly_sales_metrics: gross - discounts - refunds)',
    cogs: 'Inventory usage (get_inventory_usage_by_month)',
    expenses: 'Journal entries on expense accounts (get_journal_expense_total)',
    closest_ui_view: 'Income Statement',
    differences:
      'The Income Statement page also adds uncategorized bank outflows and payroll that has no journal entry, ' +
      'and it can take revenue and COGS from other sources. Its totals can be higher than these.',
  };
}

/** Sources of the generate_report monthly_pnl figures. */
export function monthlyPnlBasis(): PnlBasis {
  return {
    revenue: 'POS net sales (get_monthly_sales_metrics: gross - discounts - refunds)',
    cogs: 'Inventory usage (get_inventory_usage_by_month)',
    expenses: 'All bank outflows in the period (get_bank_transaction_summary)',
    closest_ui_view: 'Dashboard monthly breakdown',
    differences:
      'Bank outflows can include inventory purchases that COGS also counts, so net_profit can be too low. ' +
      'Transfers are not excluded. The dashboard excludes transfers, adds pending outflows, ' +
      'and does not subtract COGS a second time.',
  };
}
