import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface BulkCategorizePosSalesParams {
  saleIds: string[];
  categoryId: string;
  restaurantId: string;
  overrideExisting: boolean;
}

/**
 * Hook for bulk categorizing POS sales
 * Applies a category to multiple sales at once
 */
export function useBulkCategorizePosSales() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ saleIds, categoryId, restaurantId, overrideExisting }: BulkCategorizePosSalesParams) => {
      // If not overriding, filter to only uncategorized sales
      let targetSaleIds = saleIds;
      
      if (!overrideExisting) {
        // First, get the uncategorized sales from the provided IDs
        const { data: uncategorizedSales, error: fetchError } = await supabase
          .from('unified_sales')
          .select('id')
          .in('id', saleIds)
          .eq('restaurant_id', restaurantId)
          .eq('is_categorized', false);

        if (fetchError) throw fetchError;
        
        targetSaleIds = uncategorizedSales?.map(sale => sale.id) || [];
        
        // If no uncategorized sales found, return early
        if (targetSaleIds.length === 0) {
          return [];
        }
      }

      const { data, error } = await supabase
        .from('unified_sales')
        .update({
          category_id: categoryId,
          is_categorized: true,
          suggested_category_id: null, // Clear AI suggestions
        })
        .in('id', targetSaleIds)
        .eq('restaurant_id', restaurantId)
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (data, variables) => {
      // Invalidate unified sales queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['unified-sales'] });
      
      const actualCount = data?.length || 0;
      const skippedCount = variables.saleIds.length - actualCount;
      
      let description = 'Changes have been applied successfully';
      if (skippedCount > 0 && !variables.overrideExisting) {
        description = `${skippedCount} already categorized ${skippedCount === 1 ? 'sale' : 'sales'} skipped`;
      }
      
      toast.success(`${actualCount} ${actualCount === 1 ? 'sale' : 'sales'} categorized`, {
        description,
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            // TODO: Implement undo functionality
            // Store previous category_id values before mutation in onMutate
            // Restore original values by updating the same saleIds
            // Example: supabase.from('unified_sales').update({ category_id: previousValues[id] }).in('id', saleIds)
            toast.info('Undo feature coming soon');
          },
        },
      });
    },
    onError: (error) => {
      console.error('Error bulk categorizing POS sales:', error);
      toast.error('Failed to categorize sales', {
        description: 'Please try again or contact support',
      });
    },
  });
}

interface BulkMapRecipeParams {
  itemName: string;
  recipeId: string;
  restaurantId: string;
}

/**
 * Hook for bulk mapping a recipe to POS items
 * Maps a recipe to all sales with the same item name
 */
export function useBulkMapRecipe() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemName, recipeId, restaurantId }: BulkMapRecipeParams) => {
      // Create a POS item mapping in the database
      const { data, error } = await supabase
        .from('pos_item_mappings')
        .upsert({
          restaurant_id: restaurantId,
          pos_item_name: itemName,
          recipe_id: recipeId,
        })
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['unified-sales'] });
      queryClient.invalidateQueries({ queryKey: ['pos-item-mappings'] });
      
      toast.success('Recipe mapped successfully', {
        description: `All "${variables.itemName}" items will now use this recipe`,
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            // TODO: Implement undo functionality
            // Delete the created mapping: supabase.from('pos_item_mappings').delete().eq('pos_item_name', itemName)
            // Or store the previous mapping and restore it if one existed
            toast.info('Undo feature coming soon');
          },
        },
      });
    },
    onError: (error) => {
      console.error('Error mapping recipe:', error);
      toast.error('Failed to map recipe');
    },
  });
}
