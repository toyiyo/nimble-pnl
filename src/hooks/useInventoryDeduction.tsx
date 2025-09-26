import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface DeductionResult {
  recipe_name: string;
  ingredients_deducted: {
    product_name: string;
    quantity_recipe_units: number;
    recipe_unit: string;
    quantity_purchase_units: number;
    purchase_unit: string;
    conversion_factor: number;
    remaining_stock_purchase_units: number;
  }[];
  total_cost: number;
}

export const useInventoryDeduction = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const processDeduction = useCallback(async (
    restaurantId: string,
    posItemName: string,
    quantitySold: number,
    saleDate: string
  ): Promise<DeductionResult | null> => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('process_inventory_deduction' as any, {
        p_restaurant_id: restaurantId,
        p_pos_item_name: posItemName,
        p_quantity_sold: quantitySold,
        p_sale_date: saleDate
      });

      if (error) throw error;
      return data as DeductionResult;
    } catch (error: any) {
      console.error('Error processing inventory deduction:', error);
      toast({
        title: "Inventory deduction failed",
        description: error.message,
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
        .eq('transaction_type', 'sale_deduction')
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
    } catch (error: any) {
      console.error('Error fetching deduction history:', error);
      toast({
        title: "Error fetching deduction history",
        description: error.message,
        variant: "destructive",
      });
      return [];
    }
  }, [toast]);

  const simulateDeduction = useCallback(async (
    restaurantId: string,
    posItemName: string,
    quantitySold: number
  ) => {
    try {
      const { data, error } = await supabase.rpc('simulate_inventory_deduction' as any, {
        p_restaurant_id: restaurantId,
        p_pos_item_name: posItemName,
        p_quantity_sold: quantitySold
      });

      if (error) throw error;
      return data as DeductionResult;
    } catch (error: any) {
      console.error('Error simulating deduction:', error);
      return null;
    }
  }, []);

  return {
    loading,
    processDeduction,
    getDeductionHistory,
    simulateDeduction,
  };
};