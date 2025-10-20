import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useReconcileBalances = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (restaurantId: string) => {
      const { data, error } = await supabase.rpc('rebuild_account_balances', {
        p_restaurant_id: restaurantId
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (accountsUpdated) => {
      toast.success(`Successfully reconciled ${accountsUpdated} accounts`);
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to reconcile balances: ${error.message}`);
    },
  });
};
