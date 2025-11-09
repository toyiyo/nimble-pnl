import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';
import { UnifiedSaleItem, POSSystemType } from '@/types/pos';

export const useUnifiedSales = (restaurantId: string | null) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const fetchUnifiedSales = useCallback(async () => {
    if (!restaurantId || !user) {
      return [];
    }

    const query = supabase
      .from('unified_sales')
      .select(`
        *,
        suggested_chart_account:chart_of_accounts!suggested_category_id (
          id,
          account_code,
          account_name,
          account_type
        ),
        approved_chart_account:chart_of_accounts!category_id (
          id,
          account_code,
          account_name,
          account_type
        )
      `)
      .eq('restaurant_id', restaurantId)
      .order('sale_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000);

    const { data, error } = await query;

    if (error) throw error;

    const transformedSales: UnifiedSaleItem[] = (data || []).map(sale => ({
      id: sale.id,
      restaurantId: sale.restaurant_id,
      posSystem: sale.pos_system as POSSystemType,
      externalOrderId: sale.external_order_id,
      externalItemId: sale.external_item_id,
      itemName: sale.item_name,
      quantity: sale.quantity,
      unitPrice: sale.unit_price,
      totalPrice: sale.total_price,
      saleDate: sale.sale_date,
      saleTime: sale.sale_time,
      posCategory: sale.pos_category,
      rawData: sale.raw_data,
      syncedAt: sale.synced_at,
      createdAt: sale.created_at,
      source: sale.pos_system,
      // AI Categorization fields
      category_id: sale.category_id,
      suggested_category_id: sale.suggested_category_id,
      ai_confidence: sale.ai_confidence as "high" | "medium" | "low" | undefined,
      ai_reasoning: sale.ai_reasoning,
      item_type: sale.item_type as "sale" | "tip" | "tax" | "discount" | "comp" | "service_charge" | "other" | undefined,
      adjustment_type: sale.adjustment_type as "tax" | "tip" | "service_charge" | "discount" | "fee" | null | undefined,
      is_categorized: sale.is_categorized || false,
      is_split: sale.is_split || false,
      parent_sale_id: sale.parent_sale_id,
      // Use approved_chart_account if categorized, otherwise suggested_chart_account
      chart_account: sale.is_categorized ? sale.approved_chart_account : sale.suggested_chart_account,
    }));

    // Compute child_splits from the flat data
    const salesWithSplits = transformedSales.map(sale => {
      if (sale.is_split) {
        // Find all child splits for this parent
        const children = transformedSales.filter(s => s.parent_sale_id === sale.id);
        return { ...sale, child_splits: children.length > 0 ? children : undefined };
      }
      return sale;
    });

    return salesWithSplits;
  }, [restaurantId, user]);

  const { data: sales = [], isLoading: loading, error } = useQuery({
    queryKey: ['unified-sales', restaurantId],
    queryFn: fetchUnifiedSales,
    enabled: !!restaurantId && !!user,
    staleTime: 60000, // 60 seconds - increased to reduce refetch frequency
    gcTime: 300000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Disable automatic refetch on window focus
    refetchOnMount: false, // Disable automatic refetch on mount
    refetchOnReconnect: false, // Disable automatic refetch on reconnect
  });

  // Fetch recipes to compute unmapped items (separate query key prevents infinite loop)
  const { data: recipes = [] } = useQuery({
    queryKey: ['recipes-for-mapping', restaurantId],
    queryFn: async () => {
      if (!restaurantId || !user) return [];
      
      const { data, error } = await supabase
        .from('recipes')
        .select('id, pos_item_name')
        .eq('restaurant_id', restaurantId)
        .not('pos_item_name', 'is', null);
        
      if (error) throw error;
      return data || [];
    },
    enabled: !!restaurantId && !!user,
    staleTime: 60000, // Same as sales - 60 seconds
    gcTime: 300000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Disable automatic refetch
    refetchOnMount: false, // Disable automatic refetch
    refetchOnReconnect: false, // Disable automatic refetch
  });

  // Compute unmapped items from sales data
  const unmappedItems = useMemo(() => {
    if (!restaurantId || sales.length === 0) {
      return [];
    }
    
    // Get unique item names from sales (exclude child splits)
    const saleItemNames = new Set(
      sales
        .filter(sale => !sale.parent_sale_id) // Only parent sales
        .map(sale => sale.itemName)
    );
    
    // Get all mapped POS item names from recipes (case-insensitive)
    const mappedItemNames = new Set(
      recipes
        .filter(recipe => recipe.pos_item_name)
        .map(recipe => recipe.pos_item_name!.toLowerCase())
    );
    
    // Return items that are NOT mapped to any recipe
    return Array.from(saleItemNames).filter(
      itemName => !mappedItemNames.has(itemName.toLowerCase())
    );
  }, [restaurantId, sales, recipes])

  // Show error toast
  useEffect(() => {
    if (error) {
      toast({
        title: "Error fetching sales data",
        description: (error as Error).message,
        variant: "destructive",
      });
    }
  }, [error, toast]);

  const getSalesByDateRange = useCallback((startDate: string, endDate: string) => {
    // Exclude parent sales that have been split (to prevent double counting)
    return sales.filter(sale => 
      sale.saleDate >= startDate && 
      sale.saleDate <= endDate &&
      !sale.parent_sale_id // Exclude child splits from aggregations
    );
  }, [sales]);

  const getSalesGroupedByItem = useCallback(() => {
    // Only include sales that are not child splits to prevent double counting
    const nonSplitSales = sales.filter(sale => !sale.parent_sale_id);
    
    const grouped = nonSplitSales.reduce((acc, sale) => {
      const key = sale.itemName;
      if (!acc[key]) {
        acc[key] = {
          item_name: sale.itemName,
          total_quantity: 0,
          total_revenue: 0,
          sale_count: 0,
        };
      }
      acc[key].total_quantity += sale.quantity;
      acc[key].total_revenue += sale.totalPrice || 0;
      acc[key].sale_count += 1;
      return acc;
    }, {} as Record<string, any>);

    return Object.values(grouped);
  }, [sales]);

  const getSalesByPOSSystem = useCallback(() => {
    const grouped = sales.reduce((acc, sale) => {
      const system = sale.posSystem;
      if (!acc[system]) {
        acc[system] = [];
      }
      acc[system].push(sale);
      return acc;
    }, {} as Record<POSSystemType, UnifiedSaleItem[]>);

    return grouped;
  }, [sales]);

  const refetchSales = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['unified-sales', restaurantId] });
  }, [queryClient, restaurantId]);

  const createManualSale = async (saleData: {
    itemName: string;
    quantity: number;
    unitPrice?: number;
    totalPrice?: number;
    saleDate: string;
    saleTime?: string;
    adjustmentType?: 'tax' | 'tip' | 'service_charge' | 'discount' | 'fee' | null;
  }) => {
    if (!restaurantId) return false;

    try {
      const { error } = await supabase
        .from('unified_sales')
        .insert({
          restaurant_id: restaurantId,
          pos_system: 'manual',
          external_order_id: `manual_${Date.now()}`,
          item_name: saleData.itemName,
          adjustment_type: saleData.adjustmentType || null,
          quantity: saleData.quantity,
          unit_price: saleData.unitPrice,
          total_price: saleData.totalPrice,
          sale_date: saleData.saleDate,
          sale_time: saleData.saleTime,
        });

      if (error) throw error;

      toast({
        title: "Sale recorded",
        description: "Manual sale has been recorded successfully",
      });

      refetchSales();
      return true;
    } catch (error) {
      console.error('Error creating manual sale:', error);
      toast({
        title: "Error",
        description: "Failed to record sale",
        variant: "destructive",
      });
      return false;
    }
  };

  const updateManualSale = async (saleId: string, saleData: {
    itemName: string;
    quantity: number;
    unitPrice?: number;
    totalPrice?: number;
    saleDate: string;
    saleTime?: string;
    adjustmentType?: 'tax' | 'tip' | 'service_charge' | 'discount' | 'fee' | null;
  }) => {
    if (!restaurantId) return false;

    try {
      const { error } = await supabase
        .from('unified_sales')
        .update({
          item_name: saleData.itemName,
          adjustment_type: saleData.adjustmentType || null,
          quantity: saleData.quantity,
          unit_price: saleData.unitPrice,
          total_price: saleData.totalPrice,
          sale_date: saleData.saleDate,
          sale_time: saleData.saleTime,
        })
        .eq('id', saleId)
        .eq('restaurant_id', restaurantId)
        .in('pos_system', ['manual', 'manual_upload']);

      if (error) throw error;

      toast({
        title: "Sale updated",
        description: "Sale has been updated successfully",
      });

      refetchSales();
      return true;
    } catch (error) {
      console.error('Error updating sale:', error);
      toast({
        title: "Error",
        description: "Failed to update sale",
        variant: "destructive",
      });
      return false;
    }
  };

  const deleteManualSale = async (saleId: string) => {
    if (!restaurantId) return false;

    try {
      const { error } = await supabase
        .from('unified_sales')
        .delete()
        .eq('id', saleId)
        .eq('restaurant_id', restaurantId)
        .in('pos_system', ['manual', 'manual_upload']);

      if (error) throw error;

      toast({
        title: "Sale deleted",
        description: "Sale has been deleted successfully",
      });

      refetchSales();
      return true;
    } catch (error) {
      console.error('Error deleting sale:', error);
      toast({
        title: "Error",
        description: "Failed to delete sale",
        variant: "destructive",
      });
      return false;
    }
  };

  return {
    sales,
    loading,
    unmappedItems,
    fetchUnifiedSales: refetchSales,
    getSalesByDateRange,
    getSalesGroupedByItem,
    getSalesByPOSSystem,
    createManualSale,
    updateManualSale,
    deleteManualSale,
  };
};