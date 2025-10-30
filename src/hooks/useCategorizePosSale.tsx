import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useCategorizePosSale = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      saleId,
      categoryId,
    }: {
      saleId: string;
      categoryId: string;
    }) => {
      const { data, error } = await supabase.rpc('categorize_pos_sale', {
        p_sale_id: saleId,
        p_category_id: categoryId,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      // Invalidate queries to refresh the data
      queryClient.invalidateQueries({ queryKey: ['unified-sales'] });
      queryClient.invalidateQueries({ queryKey: ['income-statement'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast.success("Sale categorized successfully.");
    },
    onError: (error: Error) => {
      toast.error(`Failed to categorize sale: ${error.message}`);
    },
  });
};
