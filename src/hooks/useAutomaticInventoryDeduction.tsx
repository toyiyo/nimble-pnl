import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useRestaurantContext } from '@/contexts/RestaurantContext';

interface BatchSale {
  pos_item_name: string;
  quantity: number;
  sale_date: string;
  external_order_id: string;
  sale_time?: string;
}

interface DeductionResponse {
  recipe_name: string;
  ingredients_deducted: any[];
  total_cost: number;
}

export const useAutomaticInventoryDeduction = () => {
  const { toast } = useToast();
  const { selectedRestaurant } = useRestaurantContext();
  const [autoDeductionEnabled, setAutoDeductionEnabled] = useState<boolean>(false);

  // Check if auto-deduction is enabled for this restaurant
  useEffect(() => {
    const checkSettings = async () => {
      if (!selectedRestaurant?.restaurant_id) return;

      const { data } = await supabase
        .from('auto_deduction_settings')
        .select('enabled')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .maybeSingle();

      setAutoDeductionEnabled(data?.enabled ?? false);
    };

    checkSettings();
  }, [selectedRestaurant?.restaurant_id]);

  // Process batch deductions for multiple sales
  const processBatchDeductions = useCallback(async (sales: BatchSale[]) => {
    if (!selectedRestaurant?.restaurant_id || !autoDeductionEnabled) return;

    try {
      // Fetch restaurant timezone
      const { data: restaurantData } = await supabase
        .from('restaurants')
        .select('timezone')
        .eq('id', selectedRestaurant.restaurant_id)
        .single();

      const restaurantTimezone = restaurantData?.timezone || 'America/Chicago';

      const results = [];
      for (const sale of sales) {
        const { data, error } = await supabase.rpc('process_unified_inventory_deduction', {
          p_restaurant_id: selectedRestaurant.restaurant_id,
          p_pos_item_name: sale.pos_item_name,
          p_quantity_sold: Math.round(sale.quantity),
          p_sale_date: sale.sale_date,
          p_external_order_id: sale.external_order_id,
          p_sale_time: sale.sale_time,
          p_restaurant_timezone: restaurantTimezone
        });

        if (error) {
          console.error(`Failed to deduct inventory for ${sale.pos_item_name}:`, error);
          continue;
        }

        const deductionData = data as unknown as DeductionResponse;
        if (deductionData && deductionData.ingredients_deducted && deductionData.ingredients_deducted.length > 0) {
          results.push({
            pos_item_name: sale.pos_item_name,
            result: deductionData
          });
        }
      }

      if (results.length > 0) {
        toast({
          title: "Inventory Updated",
          description: `Processed ${results.length} automatic inventory deductions from POS sales`,
        });
      }

      return results;
    } catch (error: any) {
      console.error('Batch deduction error:', error);
      toast({
        title: "Deduction Error", 
        description: "Failed to process some inventory deductions",
        variant: "destructive",
      });
    }
  }, [selectedRestaurant?.restaurant_id, autoDeductionEnabled, toast]);

  // Listen for new unified sales and auto-deduct
  const setupAutoDeduction = useCallback(async () => {
    if (!selectedRestaurant?.restaurant_id || !autoDeductionEnabled) return;

    try {
      // Get sales from today that haven't been processed
      const today = new Date().toISOString().split('T')[0];
      
      const { data: unprocessedSales } = await supabase
        .from('unified_sales')
        .select('item_name, quantity, sale_date, sale_time, external_order_id')
        .eq('restaurant_id', selectedRestaurant.restaurant_id)
        .gte('sale_date', today)
        .order('created_at', { ascending: false });

      if (!unprocessedSales?.length) return;

      // Filter out sales that have already been processed
      const salesToProcess: BatchSale[] = [];
      
      for (const sale of unprocessedSales) {
      const { data: alreadyProcessed } = await supabase.rpc('check_sale_already_processed', {
        p_restaurant_id: selectedRestaurant.restaurant_id,
        p_pos_item_name: sale.item_name,
        p_quantity_sold: Math.round(sale.quantity),
        p_sale_date: sale.sale_date,
        p_external_order_id: sale.external_order_id
      });

      if (!alreadyProcessed) {
          salesToProcess.push({
            pos_item_name: sale.item_name,
            quantity: sale.quantity,
            sale_date: sale.sale_date,
            sale_time: sale.sale_time,
            external_order_id: sale.external_order_id
          });
        }
      }

      if (salesToProcess.length > 0) {
        await processBatchDeductions(salesToProcess);
      }

    } catch (error: any) {
      console.error('Auto deduction setup error:', error);
    }
  }, [selectedRestaurant?.restaurant_id, autoDeductionEnabled, processBatchDeductions]);

  // Set up real-time subscription for new sales - DISABLED
  // The database trigger already handles automatic deductions
  // This subscription was causing double-counting
  /*
  useEffect(() => {
    if (!selectedRestaurant?.restaurant_id || !autoDeductionEnabled) return;

    const channel = supabase
      .channel('unified_sales_changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'unified_sales',
          filter: `restaurant_id=eq.${selectedRestaurant.restaurant_id}`
        },
        async (payload) => {
          const newSale = payload.new;
          
          // Small delay to ensure transaction is committed
          setTimeout(async () => {
            await processBatchDeductions([{
              pos_item_name: newSale.item_name,
              quantity: Math.round(newSale.quantity),
              sale_date: newSale.sale_date,
              external_order_id: newSale.external_order_id
            }]);
          }, 1000);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedRestaurant?.restaurant_id, autoDeductionEnabled, processBatchDeductions]);
  */

  return {
    processBatchDeductions,
    setupAutoDeduction,
  };
};