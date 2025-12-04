import { useEffect, useCallback, useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';
import { UnifiedSaleItem, POSSystemType } from '@/types/pos';
import { createMappedItemNamesSet, hasRecipeMappingFromSet } from '@/utils/recipeMapping';

const PAGE_SIZE = 200;

type UseUnifiedSalesOptions = {
  searchTerm?: string;
  startDate?: string;
  endDate?: string;
};

export const useUnifiedSales = (restaurantId: string | null, options: UseUnifiedSalesOptions = {}) => {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const normalizedSearchTerm = options.searchTerm?.trim();
  const normalizedStartDate = options.startDate?.trim();
  const normalizedEndDate = options.endDate?.trim();
  const queryKey = useMemo(
    () => ['unified-sales', restaurantId, normalizedSearchTerm || '', normalizedStartDate || '', normalizedEndDate || ''],
    [restaurantId, normalizedSearchTerm, normalizedStartDate, normalizedEndDate]
  );

  const fetchUnifiedSalesPage = useCallback(
    async ({ pageParam = 0 }: { pageParam?: number }) => {
      if (!restaurantId || !user) {
        return { sales: [], hasMore: false };
      }

      const from = pageParam;
      const to = pageParam + PAGE_SIZE - 1;

      let query = supabase
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
        .eq('restaurant_id', restaurantId);

      if (normalizedSearchTerm) {
        query = query.ilike('item_name', `%${normalizedSearchTerm}%`);
      }

      if (normalizedStartDate) {
        query = query.gte('sale_date', normalizedStartDate);
      }

      if (normalizedEndDate) {
        query = query.lte('sale_date', normalizedEndDate);
      }

      query = query
        .order('sale_date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, to);

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

      // Compute child_splits from the flat data in this page
      const salesWithSplits = transformedSales.map(sale => {
        if (sale.is_split) {
          const children = transformedSales.filter(s => s.parent_sale_id === sale.id);
          return { ...sale, child_splits: children.length > 0 ? children : undefined };
        }
        return sale;
      });

      return { sales: salesWithSplits, hasMore: (data?.length ?? 0) === PAGE_SIZE };
    },
    [restaurantId, user, normalizedSearchTerm, normalizedStartDate, normalizedEndDate]
  );

  const {
    data,
    isLoading: loading,
    isFetchingNextPage: loadingMore,
    error,
    fetchNextPage,
    hasNextPage,
  } = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam = 0 }) => fetchUnifiedSalesPage({ pageParam: pageParam as number }),
    getNextPageParam: (lastPage: any) => (lastPage?.hasMore ? (lastPage?.nextPage || 0) : undefined),
    initialPageParam: 0,
    enabled: !!restaurantId && !!user,
    staleTime: 60000,
    gcTime: 300000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });

  const flatSales = useMemo(() => {
    const salesList = data?.pages.flatMap((page: any) => page?.sales || []) ?? [];
    if (!salesList.length) return [];

    // Build child splits across pages to avoid missing links
    const childrenByParent = salesList.reduce((acc, sale) => {
      if (sale.parent_sale_id) {
        if (!acc[sale.parent_sale_id]) acc[sale.parent_sale_id] = [];
        acc[sale.parent_sale_id].push(sale);
      }
      return acc;
    }, {} as Record<string, UnifiedSaleItem[]>);

    return salesList.map(sale => {
      if (sale.is_split) {
        const children = childrenByParent[sale.id] || [];
        return { ...sale, child_splits: children.length ? children : sale.child_splits };
      }
      return sale;
    });
  }, [data]);

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

  // Compute unmapped items from sales data using tested utility functions
  const unmappedItems = useMemo(() => {
    if (!restaurantId || flatSales.length === 0) {
      return [];
    }
    
    // Create recipe mapping set for quick lookup (uses tested utility)
    const mappedItemNames = createMappedItemNamesSet(recipes);
    
    // Get unique item names from sales (exclude child splits)
    const saleItemNames = new Set(
      flatSales
        .filter(sale => !sale.parent_sale_id) // Only parent sales
        .map(sale => sale.itemName)
    );
    
    // Return items that are NOT mapped to any recipe (uses tested utility)
    return Array.from(saleItemNames).filter(
      itemName => !hasRecipeMappingFromSet(itemName, mappedItemNames)
    );
  }, [restaurantId, flatSales, recipes]);

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
    return flatSales.filter(sale => 
      sale.saleDate >= startDate && 
      sale.saleDate <= endDate &&
      !sale.parent_sale_id // Exclude child splits from aggregations
    );
  }, [flatSales]);

  const getSalesGroupedByItem = useCallback(() => {
    // Only include sales that are not child splits to prevent double counting
    const nonSplitSales = flatSales.filter(sale => !sale.parent_sale_id);
    
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
  }, [flatSales]);

  const getSalesByPOSSystem = useCallback(() => {
    const grouped = flatSales.reduce((acc, sale) => {
      const system = sale.posSystem;
      if (!acc[system]) {
        acc[system] = [];
      }
      acc[system].push(sale);
      return acc;
    }, {} as Record<POSSystemType, UnifiedSaleItem[]>);

    return grouped;
  }, [flatSales]);

  const refetchSales = useCallback(() => {
    queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const loadMoreSales = useCallback(() => {
    if (hasNextPage) {
      fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage]);

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

  const createManualSaleWithAdjustments = async (saleData: {
    itemName: string;
    quantity: number;
    unitPrice?: number;
    totalPrice?: number;
    saleDate: string;
    saleTime?: string;
    adjustments?: {
      tax?: number;
      tip?: number;
      serviceCharge?: number;
      discount?: number;
      fee?: number;
    };
  }) => {
    if (!restaurantId) return false;

    try {
      // Generate a unique order ID to group all entries
      const orderId = `manual_${Date.now()}`;
      const entries = [];

      // Main revenue item
      entries.push({
        restaurant_id: restaurantId,
        pos_system: 'manual',
        external_order_id: orderId,
        item_name: saleData.itemName,
        adjustment_type: null,
        quantity: saleData.quantity,
        unit_price: saleData.unitPrice,
        total_price: saleData.totalPrice,
        sale_date: saleData.saleDate,
        sale_time: saleData.saleTime,
      });

      // Add adjustment entries
      if (saleData.adjustments) {
        if (saleData.adjustments.tax && saleData.adjustments.tax > 0) {
          entries.push({
            restaurant_id: restaurantId,
            pos_system: 'manual',
            external_order_id: orderId,
            item_name: 'Sales Tax',
            adjustment_type: 'tax',
            quantity: 1,
            unit_price: saleData.adjustments.tax,
            total_price: saleData.adjustments.tax,
            sale_date: saleData.saleDate,
            sale_time: saleData.saleTime,
          });
        }
        if (saleData.adjustments.tip && saleData.adjustments.tip > 0) {
          entries.push({
            restaurant_id: restaurantId,
            pos_system: 'manual',
            external_order_id: orderId,
            item_name: 'Tip',
            adjustment_type: 'tip',
            quantity: 1,
            unit_price: saleData.adjustments.tip,
            total_price: saleData.adjustments.tip,
            sale_date: saleData.saleDate,
            sale_time: saleData.saleTime,
          });
        }
        if (saleData.adjustments.serviceCharge && saleData.adjustments.serviceCharge > 0) {
          entries.push({
            restaurant_id: restaurantId,
            pos_system: 'manual',
            external_order_id: orderId,
            item_name: 'Service Charge',
            adjustment_type: 'service_charge',
            quantity: 1,
            unit_price: saleData.adjustments.serviceCharge,
            total_price: saleData.adjustments.serviceCharge,
            sale_date: saleData.saleDate,
            sale_time: saleData.saleTime,
          });
        }
        if (saleData.adjustments.discount && saleData.adjustments.discount > 0) {
          entries.push({
            restaurant_id: restaurantId,
            pos_system: 'manual',
            external_order_id: orderId,
            item_name: 'Discount',
            adjustment_type: 'discount',
            quantity: 1,
            unit_price: saleData.adjustments.discount,
            total_price: saleData.adjustments.discount,
            sale_date: saleData.saleDate,
            sale_time: saleData.saleTime,
          });
        }
        if (saleData.adjustments.fee && saleData.adjustments.fee > 0) {
          entries.push({
            restaurant_id: restaurantId,
            pos_system: 'manual',
            external_order_id: orderId,
            item_name: 'Platform Fee',
            adjustment_type: 'fee',
            quantity: 1,
            unit_price: saleData.adjustments.fee,
            total_price: saleData.adjustments.fee,
            sale_date: saleData.saleDate,
            sale_time: saleData.saleTime,
          });
        }
      }

      const { error } = await supabase
        .from('unified_sales')
        .insert(entries);

      if (error) throw error;

      const adjCount = entries.length - 1;
      toast({
        title: "Sale recorded",
        description: `Manual sale with ${adjCount} adjustment${adjCount !== 1 ? 's' : ''} has been recorded successfully`,
      });

      refetchSales();
      return true;
    } catch (error) {
      console.error('Error creating manual sale with adjustments:', error);
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
    sales: flatSales,
    loading,
    loadingMore,
    hasMore: !!hasNextPage,
    loadMoreSales,
    unmappedItems,
    fetchUnifiedSales: refetchSales,
    getSalesByDateRange,
    getSalesGroupedByItem,
    getSalesByPOSSystem,
    createManualSale,
    createManualSaleWithAdjustments,
    updateManualSale,
    deleteManualSale,
  };
};
