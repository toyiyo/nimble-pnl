import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useCategorizeTransactions = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (restaurantId: string) => {
      const { data, error } = await supabase.functions.invoke(
        'ai-categorize-transactions',
        {
          body: { restaurantId }
        }
      );

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      const result = data as { 
        message: string; 
        count: number; 
        categorized: number;
        remaining?: number;
        hasMore?: boolean;
      };
      
      // Show success message
      toast.success(result?.message || 'AI has suggested categories for your transactions.');
      
      queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
      queryClient.invalidateQueries({ queryKey: ['balance-sheet'] });
      queryClient.invalidateQueries({ queryKey: ['income-statement'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to categorize transactions: ${error.message}`);
    },
  });
};
