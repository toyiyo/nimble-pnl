import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useCategorizePosSale = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      saleId,
      categoryId,
      accountInfo,
    }: {
      saleId: string;
      categoryId: string;
      accountInfo?: { account_name: string; account_code: string };
    }) => {
      const { data, error } = await supabase.rpc('categorize_pos_sale', {
        p_sale_id: saleId,
        p_category_id: categoryId,
      });

      if (error) throw error;
      return { data, saleId, categoryId, accountInfo };
    },
    onMutate: async ({ saleId, categoryId, accountInfo }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: ['unified-sales'] });

      // Snapshot the previous value
      const previousSales = queryClient.getQueryData(['unified-sales']);

      // Optimistically update the cache
      queryClient.setQueryData(['unified-sales'], (old: any) => {
        if (!old) return old;
        
        return old.map((sale: any) => {
          if (sale.id === saleId) {
            return {
              ...sale,
              category_id: categoryId,
              is_categorized: true,
              suggested_category_id: null,
              ai_confidence: null,
              ai_reasoning: null,
              chart_account: accountInfo || sale.chart_account,
            };
          }
          return sale;
        });
      });

      return { previousSales };
    },
    onError: (error: Error, variables, context) => {
      // Rollback on error
      if (context?.previousSales) {
        queryClient.setQueryData(['unified-sales'], context.previousSales);
      }
      toast.error(`Failed to categorize sale: ${error.message}`);
    },
    onSuccess: () => {
      // Invalidate related queries for consistency
      queryClient.invalidateQueries({ queryKey: ['income-statement'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast.success("Sale categorized successfully.");
    },
  });
};
