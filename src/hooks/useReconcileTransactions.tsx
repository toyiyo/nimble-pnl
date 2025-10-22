import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ReconcileTransactionsParams {
  transactionIds: string[];
  accountBalanceId: string;
  connectedBankId: string;
  accountName: string;
  adjustedStatementBalance: number;
  endingDate: Date;
}

export function useReconcileTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      transactionIds, 
      accountBalanceId,
      connectedBankId,
      accountName, 
      adjustedStatementBalance, 
      endingDate 
    }: ReconcileTransactionsParams) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      // Mark all selected transactions as reconciled (single batch operation)
      const { error: txError } = await supabase
        .from('bank_transactions')
        .update({
          is_reconciled: true,
          reconciled_at: new Date().toISOString(),
          reconciled_by: user?.id,
        })
        .in('id', transactionIds);
      
      if (txError) throw txError;

      // Insert a new balance snapshot to preserve history
      const { error: balError } = await supabase
        .from('bank_account_balances')
        .insert({
          connected_bank_id: connectedBankId,
          account_name: accountName,
          current_balance: adjustedStatementBalance,
          as_of_date: endingDate.toISOString(),
          is_active: true,
        });
      
      if (balError) throw balError;

      return transactionIds.length;
    },
    onSuccess: (count, variables) => {
      toast.success(`Reconciled ${count} transactions successfully`);
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['account-balance', variables.accountBalanceId] });
    },
    onError: (error) => {
      if (import.meta.env.DEV) {
        console.error('Reconciliation error:', error);
      }
      toast.error('Failed to complete reconciliation');
    },
  });
}
