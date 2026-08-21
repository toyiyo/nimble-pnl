import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { startOfMonth, subMonths } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useRestaurantContext } from '@/contexts/RestaurantContext';
import { toDateOnlyString, toInclusiveDayEnd } from '@/lib/dateOnly';
import { fetchAllPages } from '@/lib/paginatedBankQuery';
import {
  type CashFlowRow,
  type CashFlowPeriod,
  type CashFlowAggregates,
  type CashFlowInsight,
  type BreakdownRow,
  dayKeyOf,
  defaultInterval,
  computeCashFlowAggregates,
  breakdown,
  computeInsights,
} from '@/lib/cashflowInsights';

const HISTORY_MONTHS = 4;

/** The full aggregate output the Cash Flow Insights view reads from one hook call. */
export interface CashFlowInsightsData {
  /** Rows inside the display period only (not the wider fetch window). */
  rows: CashFlowRow[];
  aggregates: CashFlowAggregates;
  /** Money in, grouped by payee. */
  sources: BreakdownRow[];
  /** Money out, grouped by payee. */
  recipients: BreakdownRow[];
  categoryBreakdownIn: BreakdownRow[];
  categoryBreakdownOut: BreakdownRow[];
  /** Computed from the full wide-window row set, not just the display period. */
  insights: CashFlowInsight[];
  /** True when the fetch hit the 20-page cap before reaching a short page. */
  truncated: boolean;
}

const EMPTY_DATA: CashFlowInsightsData = {
  rows: [],
  aggregates: { totals: { moneyIn: 0, moneyOut: 0, net: 0 }, series: [] },
  sources: [],
  recipients: [],
  categoryBreakdownIn: [],
  categoryBreakdownOut: [],
  insights: [],
  truncated: false,
};

interface FetchResult {
  rows: CashFlowRow[];
  truncated: boolean;
}

/**
 * Fetch every posted `bank_transactions` row in the window, in 1000-row
 * pages ordered by `transaction_date` ascending. Stops at 20 pages
 * (20,000 rows) and reports `truncated: true` when the cap is hit before
 * a page comes back short.
 */
async function fetchAllRows(
  restaurantId: string,
  fetchFrom: string,
  fetchTo: string,
  bankAccountId: string,
): Promise<FetchResult> {
  const { rows, truncated } = await fetchAllPages<CashFlowRow>(async (from, to) => {
    let query = supabase
      .from('bank_transactions')
      .select(
        'id, transaction_date, amount, is_transfer, normalized_payee, merchant_name, description, category:chart_of_accounts!category_id(id, name:account_name, account_type, account_subtype)',
      )
      .eq('restaurant_id', restaurantId)
      .eq('status', 'posted')
      .gte('transaction_date', fetchFrom)
      .lte('transaction_date', toInclusiveDayEnd(fetchTo));

    if (bankAccountId && bankAccountId !== 'all') {
      query = query.eq('connected_bank_id', bankAccountId);
    }

    // Paging stability rule: see fetchAllPages in paginatedBankQuery.ts.
    const { data, error } = await query
      .order('transaction_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    return { data: (data ?? null) as unknown as CashFlowRow[] | null, error };
  });

  return { rows, truncated };
}

/**
 * Fetch and aggregate the rows behind the Cash Flow Insights view.
 *
 * Fetches a window from `min(period.from, startOfMonth(subMonths(period.to,
 * 4)))` to `period.to` so the narrative's month-over-month comparisons have
 * history, then memoizes the visual aggregates (totals, series, breakdowns)
 * from rows inside `period` only, and the insights from the full wide-window
 * row set. `CashFlowChart` derives the Sankey and top-category views itself
 * from `data.rows`, filtered by its own in-chart controls.
 */
export function useCashFlowInsights(period: CashFlowPeriod, bankAccountId: string = 'all') {
  const { selectedRestaurant } = useRestaurantContext();
  const restaurantId = selectedRestaurant?.restaurant_id;

  const periodFromKey = toDateOnlyString(period.from);
  const periodToKey = toDateOnlyString(period.to);

  const fetchFromKey = useMemo(() => {
    const historyStart = startOfMonth(subMonths(period.to, HISTORY_MONTHS));
    return period.from < historyStart ? periodFromKey : toDateOnlyString(historyStart);
  }, [period.from, period.to, periodFromKey]);

  const query = useQuery({
    queryKey: ['cashflow-insights', restaurantId, periodFromKey, periodToKey, bankAccountId],
    queryFn: () => fetchAllRows(restaurantId as string, fetchFromKey, periodToKey, bankAccountId),
    enabled: !!restaurantId,
    staleTime: 30000,
    refetchOnWindowFocus: true,
  });

  const allRows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const truncated = query.data?.truncated ?? false;

  const periodRows = useMemo(
    () =>
      allRows.filter((row) => {
        const dayKey = dayKeyOf(row.transaction_date);
        return dayKey >= periodFromKey && dayKey <= periodToKey;
      }),
    [allRows, periodFromKey, periodToKey],
  );

  const data = useMemo<CashFlowInsightsData>(() => {
    if (!query.data) return EMPTY_DATA;

    const interval = defaultInterval(period);

    return {
      rows: periodRows,
      // Internal transfers stay out of the headline and the breakdown
      // totals. The chart adds them back through its own filter control.
      aggregates: computeCashFlowAggregates(periodRows, period, interval, { excludeTransfers: true }),
      sources: breakdown(periodRows, 'in', 'payee'),
      recipients: breakdown(periodRows, 'out', 'payee'),
      categoryBreakdownIn: breakdown(periodRows, 'in', 'category'),
      categoryBreakdownOut: breakdown(periodRows, 'out', 'category'),
      insights: computeInsights(allRows, period),
      truncated,
    };
  }, [query.data, periodRows, allRows, period, truncated]);

  return { ...query, data };
}
