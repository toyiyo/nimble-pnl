import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';

export interface POSSale {
  id: string;
  restaurant_id: string;
  pos_item_name: string;
  pos_item_id?: string;
  quantity: number;
  sale_price?: number;
  sale_date: string;
  sale_time?: string;
  created_at: string;
  raw_data?: any;
}

export interface CreatePOSSaleData {
  restaurant_id: string;
  pos_item_name: string;
  pos_item_id?: string;
  quantity: number;
  sale_price?: number;
  sale_date: string;
  sale_time?: string;
  raw_data?: any;
}

export const usePOSSales = (restaurantId: string | null) => {
  const [sales, setSales] = useState<POSSale[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchSales = useCallback(async (startDate?: string, endDate?: string) => {
    if (!restaurantId || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      let query = supabase
        .from('pos_sales')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .order('sale_date', { ascending: false })
        .order('sale_time', { ascending: false });

      if (startDate) {
        query = query.gte('sale_date', startDate);
      }
      if (endDate) {
        query = query.lte('sale_date', endDate);
      }

      const { data, error } = await query.limit(1000);

      if (error) throw error;
      setSales(data || []);
    } catch (error: any) {
      console.error('Error fetching POS sales:', error);
      toast({
        title: "Error fetching sales data",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, user, toast]);

  const createSale = async (saleData: CreatePOSSaleData): Promise<POSSale | null> => {
    if (!user) return null;

    try {
      const { data: sale, error } = await supabase
        .from('pos_sales')
        .insert(saleData)
        .select()
        .single();

      if (error) throw error;

      setSales(prev => [sale, ...prev]);
      
      // Trigger inventory deduction
      await processInventoryDeduction(sale);

      toast({
        title: "Sale recorded",
        description: `${sale.quantity}x ${sale.pos_item_name} recorded successfully.`,
      });

      return sale;
    } catch (error: any) {
      console.error('Error creating sale:', error);
      toast({
        title: "Error recording sale",
        description: error.message,
        variant: "destructive",
      });
      return null;
    }
  };

  const bulkCreateSales = async (salesData: CreatePOSSaleData[]): Promise<boolean> => {
    if (!user || salesData.length === 0) return false;

    try {
      const { data: newSales, error } = await supabase
        .from('pos_sales')
        .insert(salesData)
        .select();

      if (error) throw error;

      setSales(prev => [...newSales, ...prev]);
      
      // Process inventory deduction for all sales
      for (const sale of newSales) {
        await processInventoryDeduction(sale);
      }

      toast({
        title: "Sales imported",
        description: `${newSales.length} sales records imported successfully.`,
      });

      return true;
    } catch (error: any) {
      console.error('Error bulk creating sales:', error);
      toast({
        title: "Error importing sales",
        description: error.message,
        variant: "destructive",
      });
      return false;
    }
  };

  const processInventoryDeduction = async (sale: POSSale) => {
    try {
      // Call the inventory deduction function
      const { error } = await supabase.rpc('process_inventory_deduction' as any, {
        p_restaurant_id: sale.restaurant_id,
        p_pos_item_name: sale.pos_item_name,
        p_quantity_sold: sale.quantity,
        p_sale_date: sale.sale_date
      });

      if (error) {
        console.error('Error processing inventory deduction:', error);
        // Don't show toast for this error as it's a background process
      }
    } catch (error) {
      console.error('Error calling inventory deduction:', error);
    }
  };

  const getSalesByDateRange = (startDate: string, endDate: string) => {
    return sales.filter(sale => 
      sale.sale_date >= startDate && sale.sale_date <= endDate
    );
  };

  const getSalesGroupedByItem = () => {
    const grouped = sales.reduce((acc, sale) => {
      const key = sale.pos_item_name;
      if (!acc[key]) {
        acc[key] = {
          item_name: sale.pos_item_name,
          total_quantity: 0,
          total_revenue: 0,
          sale_count: 0,
        };
      }
      acc[key].total_quantity += sale.quantity;
      acc[key].total_revenue += sale.sale_price || 0;
      acc[key].sale_count += 1;
      return acc;
    }, {} as Record<string, any>);

    return Object.values(grouped);
  };

  useEffect(() => {
    fetchSales();
  }, [fetchSales]);

  return {
    sales,
    loading,
    fetchSales,
    createSale,
    bulkCreateSales,
    getSalesByDateRange,
    getSalesGroupedByItem,
  };
};