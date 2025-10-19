import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useCategorizeTransactions = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (restaurantId: string) => {
      const { data, error } = await supabase.functions.invoke(
        'categorize-uncategorized-transactions',
        {
          body: { restaurantId }
        }
      );

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(data.message || 'Transactions categorized successfully');
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['income-statement'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to categorize transactions: ${error.message}`);
    },
  });
};
