import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';

export interface UncategorizedTotals {
  uncategorizedInflows: number;
  uncategorizedOutflows: number;
  uncategorizedCount: number;
}

const EMPTY: UncategorizedTotals = { uncategorizedInflows: 0, uncategorizedOutflows: 0, uncategorizedCount: 0 };

/**
 * Fetch uncategorized bank transaction totals for a date range.
 * Exported for direct testing; the hook wraps this in React Query.
 */
export async function fetchUncategorizedTotals(
  restaurantId: string | null,
  fromStr: string,
  toStr: string,
): Promise<UncategorizedTotals> {
  if (!restaurantId) return EMPTY;

  // Fetch all uncategorized, non-transfer transactions in date range
  const { data, error } = await supabase
    .from('bank_transactions')
    .select('amount')
    .eq('restaurant_id', restaurantId)
    .is('category_id', null)
    .eq('is_transfer', false)
    .in('status', ['posted', 'pending'])
    .gte('transaction_date', fromStr)
    .lte('transaction_date', toStr);

  if (error) throw new Error(`Failed to fetch uncategorized transactions: ${error.message}`);

  let inflows = 0;
  let outflows = 0;
  const rows = data || [];

  for (const row of rows) {
    const amt = Number(row.amount) || 0;
    if (amt > 0) inflows += amt;
    else if (amt < 0) outflows += Math.abs(amt);
  }

  return {
    uncategorizedInflows: inflows,
    uncategorizedOutflows: outflows,
    uncategorizedCount: rows.length,
  };
}

export function useUncategorizedTotals(
  restaurantId: string | null,
  dateFrom: Date,
  dateTo: Date,
) {
  const fromStr = format(dateFrom, 'yyyy-MM-dd');
  const toStr = format(dateTo, 'yyyy-MM-dd');

  const { data, isLoading, error, isError } = useQuery({
    queryKey: ['uncategorized-totals', restaurantId, fromStr, toStr],
    queryFn: () => fetchUncategorizedTotals(restaurantId, fromStr, toStr),
    enabled: !!restaurantId,
    staleTime: 30000,
  });

  return {
    ...(data || EMPTY),
    isLoading,
    error,
    isError,
  };
}
