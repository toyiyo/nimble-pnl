import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';

export interface SquareSaleItem {
  id: string;
  name: string;
  catalog_object_id: string | null;
  quantity: number;
  base_price_money: number | null;
  total_money: number | null;
  order_id: string;
  service_date: string | null;
  created_at: string;
}

export interface SquareOrder {
  id: string;
  order_id: string;
  service_date: string | null;
  gross_sales_money: number | null;
  total_discount_money: number | null;
  state: string | null;
  closed_at: string | null;
  items: SquareSaleItem[];
}

export const useSquareSales = (restaurantId: string | null) => {
  const [sales, setSales] = useState<SquareOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [unmappedItems, setUnmappedItems] = useState<string[]>([]);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchSquareSales = useCallback(async (startDate?: string, endDate?: string) => {
    if (!restaurantId || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Fetch orders with line items
      let orderQuery = supabase
        .from('square_orders')
        .select(`
          *,
          square_order_line_items(*)
        `)
        .eq('restaurant_id', restaurantId)
        .eq('state', 'COMPLETED')
        .order('service_date', { ascending: false });

      if (startDate) {
        orderQuery = orderQuery.gte('service_date', startDate);
      }
      if (endDate) {
        orderQuery = orderQuery.lte('service_date', endDate);
      }

      const { data: orders, error } = await orderQuery.limit(1000);

      if (error) throw error;

      // Transform data
      const transformedSales: SquareOrder[] = (orders || []).map((order: any) => ({
        id: order.id,
        order_id: order.order_id,
        service_date: order.service_date,
        gross_sales_money: order.gross_sales_money,
        total_discount_money: order.total_discount_money,
        state: order.state,
        closed_at: order.closed_at,
        items: (order.square_order_line_items || []).map((item: any) => ({
          id: item.id,
          name: item.name || 'Unknown Item',
          catalog_object_id: item.catalog_object_id,
          quantity: item.quantity || 0,
          base_price_money: item.base_price_money,
          total_money: item.total_money,
          order_id: item.order_id,
          service_date: order.service_date,
          created_at: item.created_at,
        }))
      }));

      setSales(transformedSales);

      // Find unmapped items (items that don't have recipes)
      const allItems = transformedSales.flatMap(order => order.items);
      const uniqueItemNames = [...new Set(allItems.map(item => item.name))];
      
      const { data: recipes } = await supabase
        .from('recipes')
        .select('pos_item_name')
        .eq('restaurant_id', restaurantId);

      const mappedItems = new Set(recipes?.map(r => r.pos_item_name).filter(Boolean) || []);
      const unmapped = uniqueItemNames.filter(name => !mappedItems.has(name));
      
      setUnmappedItems(unmapped);

    } catch (error: any) {
      console.error('Error fetching Square sales:', error);
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
      sale.service_date && sale.service_date >= startDate && sale.service_date <= endDate
    );
  };

  const getSalesGroupedByItem = () => {
    const allItems = sales.flatMap(order => order.items);
    const grouped = allItems.reduce((acc, item) => {
      const key = item.name;
      if (!acc[key]) {
        acc[key] = {
          item_name: item.name,
          total_quantity: 0,
          total_revenue: 0,
          sale_count: 0,
        };
      }
      acc[key].total_quantity += item.quantity;
      acc[key].total_revenue += (item.total_money || 0) / 100; // Convert from cents
      acc[key].sale_count += 1;
      return acc;
    }, {} as Record<string, any>);

    return Object.values(grouped);
  };

  useEffect(() => {
    fetchSquareSales();
  }, [fetchSquareSales]);

  return {
    sales,
    loading,
    unmappedItems,
    fetchSquareSales,
    getSalesByDateRange,
    getSalesGroupedByItem,
  };
};