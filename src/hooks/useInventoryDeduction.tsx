import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { simulateDeductionClientSide } from '@/utils/inventorySimulation';
import type { ConversionWarning } from '@/utils/inventorySimulation';

// Re-export types for consumers
export type { ConversionWarning } from '@/utils/inventorySimulation';

export interface DeductionResult {
  recipe_name: string;
  recipe_id?: string | null;
  ingredients_deducted: {
    product_name: string;
    product_id?: string;
    quantity_recipe_units: number;
    recipe_unit: string;
    quantity_purchase_units: number;
    purchase_unit: string;
    remaining_stock_purchase_units: number;
    conversion_method?: string;
    cost_per_unit?: number;
    total_cost?: number;
  }[];
  total_cost: number;
  conversion_warnings?: ConversionWarning[];
  already_processed?: boolean;
  has_recipe?: boolean;
}

export const useInventoryDeduction = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const processDeduction = useCallback(async (
    restaurantId: string,
    posItemName: string,
    quantitySold: number,
    saleDate: string,
    saleTime?: string,
    restaurantTimezone?: string,
    externalOrderId?: string
  ): Promise<DeductionResult | null> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('process_unified_inventory_deduction', {
        p_restaurant_id: restaurantId,
        p_pos_item_name: posItemName,
        p_quantity_sold: Math.round(quantitySold), // Ensure integer for PostgreSQL
        p_sale_date: saleDate,
        p_external_order_id: externalOrderId || null,
        p_sale_time: saleTime || null,
        p_restaurant_timezone: restaurantTimezone || 'America/Chicago'
      });

      if (error) throw error;
      return data as unknown as DeductionResult;
    } catch (error: unknown) {
      console.error('Error processing inventory deduction:', error);
      toast({
        title: "Inventory deduction failed",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const getDeductionHistory = useCallback(async (
    restaurantId: string,
    startDate?: string,
    endDate?: string
  ) => {
    try {
      let query = supabase
        .from('inventory_transactions')
        .select(`
          *,
          product:products(name, sku)
        `)
        .eq('restaurant_id', restaurantId)
        .eq('transaction_type', 'usage')
        .order('created_at', { ascending: false });

      if (startDate) {
        query = query.gte('created_at', startDate);
      }
      if (endDate) {
        query = query.lte('created_at', endDate);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error: unknown) {
      console.error('Error fetching deduction history:', error);
      toast({
        title: "Error fetching deduction history",
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: "destructive",
      });
      return [];
    }
  }, [toast]);

  const simulateDeduction = useCallback(async (
    restaurantId: string,
    posItemName: string,
    quantitySold: number
  ): Promise<DeductionResult | null> => {
    setLoading(true);
    try {
      // Use client-side simulation instead of RPC for DRY principle
      // This uses the same tested conversion logic as the UI previews
      const result = await simulateDeductionClientSide(restaurantId, posItemName, quantitySold);
      
      // Map SimulationResult to DeductionResult format
      return {
        recipe_name: result.recipe_name,
        recipe_id: result.recipe_id,
        ingredients_deducted: result.ingredients_deducted,
        total_cost: result.total_cost,
        conversion_warnings: result.conversion_warnings,
        has_recipe: result.has_recipe,
      };
    } catch (error: unknown) {
      console.error('Error simulating deduction:', error);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const checkSaleProcessed = useCallback(async (
    restaurantId: string,
    posItemName: string,
    quantitySold: number,
    saleDate: string
  ) => {
    try {
      const { data, error } = await supabase.rpc('check_sale_already_processed', {
        p_restaurant_id: restaurantId,
        p_pos_item_name: posItemName,
        p_quantity_sold: quantitySold,
        p_sale_date: saleDate
      });

      if (error) throw error;
      return data as unknown as boolean;
    } catch (error: unknown) {
      console.error('Error checking if sale processed:', error);
      return false;
    }
  }, []);

  return {
    loading,
    processDeduction,
    getDeductionHistory,
    simulateDeduction,
    checkSaleProcessed,
  };
};