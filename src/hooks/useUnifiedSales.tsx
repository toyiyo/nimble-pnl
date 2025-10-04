import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';
import { UnifiedSaleItem, POSSystemType } from '@/types/pos';

export const useUnifiedSales = (restaurantId: string | null) => {
  const [sales, setSales] = useState<UnifiedSaleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unmappedItems, setUnmappedItems] = useState<string[]>([]);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchUnifiedSales = useCallback(async (startDate?: string, endDate?: string) => {
    if (!restaurantId || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      let query = supabase
        .from('unified_sales')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('sale_date', { ascending: false })
        .order('created_at', { ascending: false });

      if (startDate) {
        query = query.gte('sale_date', startDate);
      }
      if (endDate) {
        query = query.lte('sale_date', endDate);
      }

      const { data, error } = await query.limit(1000);

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
      }));

      setSales(transformedSales);

      // Find unmapped items (items that don't have recipes)
      // Match the logic used in process_unified_inventory_deduction which checks BOTH pos_item_name AND name
      const uniqueItemNames = [...new Set(transformedSales.map(sale => sale.itemName))];
      
      const { data: recipes } = await supabase
        .from('recipes')
        .select('pos_item_name, name')
        .eq('restaurant_id', restaurantId)
        .eq('is_active', true);

      // Create a set of all possible matches (both pos_item_name and recipe name)
      const mappedItems = new Set<string>();
      recipes?.forEach(r => {
        if (r.pos_item_name) mappedItems.add(r.pos_item_name);
        if (r.name) mappedItems.add(r.name);
      });
      
      const unmapped = uniqueItemNames.filter(name => !mappedItems.has(name));
      
      setUnmappedItems(unmapped);

    } catch (error: any) {
      console.error('Error fetching unified sales:', error);
      toast({
        title: "Error fetching sales data",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, user, toast]);

  const getSalesByDateRange = (startDate: string, endDate: string) => {
    return sales.filter(sale => 
      sale.saleDate >= startDate && sale.saleDate <= endDate
    );
  };

  const getSalesGroupedByItem = () => {
    const grouped = sales.reduce((acc, sale) => {
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
  };

  const getSalesByPOSSystem = () => {
    const grouped = sales.reduce((acc, sale) => {
      const system = sale.posSystem;
      if (!acc[system]) {
        acc[system] = [];
      }
      acc[system].push(sale);
      return acc;
    }, {} as Record<POSSystemType, UnifiedSaleItem[]>);

    return grouped;
  };

  const createManualSale = async (saleData: {
    itemName: string;
    quantity: number;
    unitPrice?: number;
    totalPrice?: number;
    saleDate: string;
    saleTime?: string;
  }): Promise<boolean> => {
    if (!restaurantId || !user) return false;

    try {
      const { error } = await supabase
        .from('unified_sales')
        .insert({
          restaurant_id: restaurantId,
          pos_system: 'manual',
          external_order_id: `manual_${Date.now()}`,
          item_name: saleData.itemName,
          quantity: saleData.quantity,
          unit_price: saleData.unitPrice,
          total_price: saleData.totalPrice || (saleData.unitPrice || 0) * saleData.quantity,
          sale_date: saleData.saleDate,
          sale_time: saleData.saleTime,
        });

      if (error) throw error;

      toast({
        title: "Sale recorded",
        description: `Manual sale for ${saleData.itemName} recorded successfully.`,
      });

      // Refresh sales data
      await fetchUnifiedSales();
      return true;
    } catch (error: any) {
      console.error('Error creating manual sale:', error);
      toast({
        title: "Error recording sale",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  useEffect(() => {
    fetchUnifiedSales();
  }, [fetchUnifiedSales]);

  return {
    sales,
    loading,
    unmappedItems,
    fetchUnifiedSales,
    getSalesByDateRange,
    getSalesGroupedByItem,
    getSalesByPOSSystem,
    createManualSale,
  };
};