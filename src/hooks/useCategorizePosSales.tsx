import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useCategorizePosSales = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (restaurantId: string) => {
      const { data, error } = await supabase.functions.invoke(
        'ai-categorize-pos-sales',
        { body: { restaurantId } }
      );

      if (error) {
        // Extract the actual error message from the edge function response
        const errorMessage = (data as any)?.error || error.message || 'Unknown error';
        throw new Error(errorMessage);
      }
      
      return data;
    },
    onSuccess: (data) => {
      const result = data as { 
        message: string; 
        count: number; 
        categorized: number;
        remaining?: number;
      };
      
      toast.success(result?.message || 'AI has suggested categories for your POS sales.');
      
      queryClient.invalidateQueries({ queryKey: ['unified-sales'] });
      queryClient.invalidateQueries({ queryKey: ['income-statement'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to categorize sales: ${error.message}`);
    },
  });
};
