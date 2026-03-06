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

  // Outflows (expenses) — amount < 0, no category
  const { data: outData, error: outErr } = await supabase
    .from('bank_transactions')
    .select('total:amount.sum(), count:amount.count()')
    .eq('restaurant_id', restaurantId)
    .is('category_id', null)
    .eq('is_transfer', false)
    .in('status', ['posted', 'pending'])
    .lt('amount', 0)
    .gte('transaction_date', fromStr)
    .lte('transaction_date', toStr)
    .maybeSingle();

  if (outErr) throw new Error(`Failed to fetch uncategorized outflows: ${outErr.message}`);

  // Inflows (revenue) — amount > 0, no category
  const { data: inData, error: inErr } = await supabase
    .from('bank_transactions')
    .select('total:amount.sum(), count:amount.count()')
    .eq('restaurant_id', restaurantId)
    .is('category_id', null)
    .eq('is_transfer', false)
    .in('status', ['posted', 'pending'])
    .gt('amount', 0)
    .gte('transaction_date', fromStr)
    .lte('transaction_date', toStr)
    .maybeSingle();

  if (inErr) throw new Error(`Failed to fetch uncategorized inflows: ${inErr.message}`);

  const outTotal = Math.abs(Number(outData?.total) || 0);
  const outCount = Number(outData?.count) || 0;
  const inTotal = Number(inData?.total) || 0;
  const inCount = Number(inData?.count) || 0;

  return {
    uncategorizedInflows: inTotal,
    uncategorizedOutflows: outTotal,
    uncategorizedCount: outCount + inCount,
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
