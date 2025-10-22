import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useOpeningBalance(
  connectedBankId: string | null | undefined, 
  endingDate: Date | undefined,
  enabled: boolean = true
) {
  return useQuery({
    queryKey: ['account-balance', connectedBankId, endingDate],
    queryFn: async () => {
      if (!connectedBankId || !endingDate) return null;
      
      // Get the most recent balance BEFORE the ending date (this is our opening balance)
      const { data, error } = await supabase
        .from('bank_account_balances')
        .select('current_balance, as_of_date')
        .eq('connected_bank_id', connectedBankId)
        .lt('as_of_date', endingDate.toISOString())
        .order('as_of_date', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      console.log('[RECONCILIATION] Opening balance:', data);
      return data?.current_balance || 0;
    },
    enabled: !!connectedBankId && !!endingDate && enabled,
  });
}
