import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export function useSyncBankTransactions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (bankId: string) => {
      // First sync transactions
      const { data: syncData, error: syncError } = await supabase.functions.invoke(
        'stripe-sync-transactions',
        {
          body: { bankId }
        }
      );

      if (syncError) throw syncError;

      // Then refresh balance
      const { data: balanceData, error: balanceError } = await supabase.functions.invoke(
        'stripe-refresh-balance',
        {
          body: { bankId }
        }
      );

      if (balanceError) {
        console.error('Balance refresh error:', balanceError);
        // Don't fail the entire operation if balance refresh fails
      }

      return { sync: syncData, balance: balanceData };
    },
    onSuccess: (data: any) => {
      const syncData = data.sync;
      const balanceData = data.balance;
      
      if (syncData.synced > 0) {
        toast({
          title: "Sync complete",
          description: `Imported ${syncData.synced} new transactions across ${balanceData.refreshed || 0} account(s)`,
        });
      } else {
        toast({
          title: "Sync complete",
          description: syncData.message || balanceData.message || "All accounts updated",
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['connected-banks'] });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
