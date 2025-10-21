import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface CashFlowData {
  operating: number;
  investing: number;
  financing: number;
  netChange: number;
  cashAccounts: string[];
}

export interface CashFlowParams {
  restaurantId: string;
  dateFrom: Date;
  dateTo: Date;
}

export function useCashFlowStatement({ restaurantId, dateFrom, dateTo }: CashFlowParams) {
  return useQuery({
    queryKey: ['cash-flow', restaurantId, dateFrom, dateTo],
    queryFn: async () => {
      // Get cash accounts (asset type, cash subtype)
      const { data: cashAccounts, error: accountsError } = await supabase
        .from('chart_of_accounts')
        .select('id, account_name')
        .eq('restaurant_id', restaurantId)
        .eq('account_type', 'asset')
        .eq('account_subtype', 'cash')
        .eq('is_active', true);

      if (accountsError) throw accountsError;

      if (!cashAccounts || cashAccounts.length === 0) {
        return { operating: 0, investing: 0, financing: 0, netChange: 0, cashAccounts: [] };
      }

      const cashAccountIds = cashAccounts.map(a => a.id);

      // Get journal entry lines for cash accounts in the date range
      const { data: cashLines, error: linesError } = await supabase
        .from('journal_entry_lines')
        .select(`
          debit_amount,
          credit_amount,
          journal_entry:journal_entries!inner(
            entry_date,
            restaurant_id,
            description
          )
        `)
        .in('account_id', cashAccountIds)
        .gte('journal_entry.entry_date', dateFrom.toISOString().split('T')[0])
        .lte('journal_entry.entry_date', dateTo.toISOString().split('T')[0])
        .eq('journal_entry.restaurant_id', restaurantId);

      if (linesError) throw linesError;

      // Calculate net cash change (debits increase cash, credits decrease cash)
      const netChange = (cashLines || []).reduce((sum, line: any) => {
        return sum + (line.debit_amount || 0) - (line.credit_amount || 0);
      }, 0);

      // For now, show all cash movement as operating activities
      // In a full implementation, you'd categorize by transaction type
      return {
        operating: netChange,
        investing: 0,
        financing: 0,
        netChange,
        cashAccounts: cashAccounts.map(a => a.account_name),
      } as CashFlowData;
    },
    enabled: !!restaurantId,
    staleTime: 60_000, // 1 minute
  });
}
