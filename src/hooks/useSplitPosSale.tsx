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

export const useRevertPosSaleSplit = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ saleId }: { saleId: string }) => {
      // Delete child splits and mark parent as not split
      const { error: deleteError } = await supabase
        .from('unified_sales')
        .delete()
        .eq('parent_sale_id', saleId);

      if (deleteError) throw deleteError;

      // Update parent to mark as not split
      const { error: updateError } = await supabase
        .from('unified_sales')
        .update({ 
          is_split: false,
          is_categorized: false,
          category_id: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', saleId);

      if (updateError) throw updateError;

      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['unified-sales'] });
      queryClient.invalidateQueries({ queryKey: ['pos-sales-splits'] });
      queryClient.invalidateQueries({ queryKey: ['chart-of-accounts'] });
      toast.success("Split reverted successfully.");
    },
    onError: (error: Error) => {
      toast.error(`Failed to revert split: ${error.message}`);
    },
  });
};

export const useUpdatePosSaleSplit = () => {
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
      // First, delete existing child splits
      const { error: deleteError } = await supabase
        .from('unified_sales')
        .delete()
        .eq('parent_sale_id', saleId);

      if (deleteError) throw deleteError;

      // Reset the parent's is_split flag so it can be split again
      const { error: resetError } = await supabase
        .from('unified_sales')
        .update({ 
          is_split: false,
          updated_at: new Date().toISOString()
        })
        .eq('id', saleId);

      if (resetError) throw resetError;

      // Then create new splits using the RPC function
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
      toast.success("Split updated successfully.");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update split: ${error.message}`);
    },
  });
};
