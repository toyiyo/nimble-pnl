import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ReconcileTransactionsParams {
  transactionIds: string[];
  accountBalanceId: string;
  adjustedStatementBalance: number;
  endingDate: Date;
}

export function useReconcileTransactions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ 
      transactionIds, 
      accountBalanceId, 
      adjustedStatementBalance, 
      endingDate 
    }: ReconcileTransactionsParams) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      
      // Mark all selected transactions as reconciled
      const updates = transactionIds.map(txnId => 
        supabase
          .from('bank_transactions')
          .update({
            is_reconciled: true,
            reconciled_at: new Date().toISOString(),
            reconciled_by: user?.id,
          })
          .eq('id', txnId)
      );

      await Promise.all(updates);

      // Update account balance using the specific bank account balance ID
      await supabase
        .from('bank_account_balances')
        .update({
          current_balance: adjustedStatementBalance,
          as_of_date: endingDate.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', accountBalanceId);

      return transactionIds.length;
    },
    onSuccess: (count) => {
      toast.success(`Reconciled ${count} transactions successfully`);
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['account-balance'] });
    },
    onError: (error) => {
      console.error('Reconciliation error:', error);
      toast.error('Failed to complete reconciliation');
    },
  });
}
