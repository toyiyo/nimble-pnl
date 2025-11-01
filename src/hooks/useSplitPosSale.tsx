import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const useSplitPosSale = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      saleId,
      splits,
    }: {
      saleId: string;
      splits: Array<{
        category_id: string;
        amount: number;
        description?: string;
      }>;
    }) => {
      const { data, error } = await supabase.rpc('split_pos_sale', {
        p_sale_id: saleId,
        p_splits: splits,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unified-sales'] });
      queryClient.invalidateQueries({ queryKey: ['pos-sales-splits'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast.success("Sale split successfully across categories.");
    },
    onError: (error: Error) => {
      toast.error(`Failed to split sale: ${error.message}`);
    },
  });
};
