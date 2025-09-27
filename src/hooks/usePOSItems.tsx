import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useToast } from '@/hooks/use-toast';

export interface POSItem {
  item_name: string;
  item_id?: string;
  source: 'pos_sales' | 'unified_sales';
  sales_count: number;
  last_sold?: string;
}

export const usePOSItems = (restaurantId: string | null) => {
  const [posItems, setPosItems] = useState<POSItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { toast } = useToast();

  const fetchPOSItems = useCallback(async () => {
    if (!restaurantId || !user) {
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      
      // Fetch from pos_sales table
      const { data: posData, error: posError } = await supabase
        .from('pos_sales')
        .select('pos_item_name, pos_item_id, sale_date')
        .eq('restaurant_id', restaurantId)
        .not('pos_item_name', 'is', null);

      // Fetch from unified_sales table
      const { data: unifiedData, error: unifiedError } = await supabase
        .from('unified_sales')
        .select('item_name, external_item_id, sale_date')
        .eq('restaurant_id', restaurantId)
        .not('item_name', 'is', null);

      if (posError) throw posError;
      if (unifiedError) throw unifiedError;

      // Combine and deduplicate POS items
      const itemMap = new Map<string, POSItem>();

      // Process pos_sales data
      posData?.forEach(item => {
        const key = item.pos_item_name.toLowerCase();
        if (itemMap.has(key)) {
          const existing = itemMap.get(key)!;
          existing.sales_count += 1;
          if (!existing.last_sold || item.sale_date > existing.last_sold) {
            existing.last_sold = item.sale_date;
            existing.item_id = item.pos_item_id || existing.item_id;
          }
        } else {
          itemMap.set(key, {
            item_name: item.pos_item_name,
            item_id: item.pos_item_id || undefined,
            source: 'pos_sales',
            sales_count: 1,
            last_sold: item.sale_date,
          });
        }
      });

      // Process unified_sales data
      unifiedData?.forEach(item => {
        const key = item.item_name.toLowerCase();
        if (itemMap.has(key)) {
          const existing = itemMap.get(key)!;
          existing.sales_count += 1;
          if (!existing.last_sold || item.sale_date > existing.last_sold) {
            existing.last_sold = item.sale_date;
            existing.item_id = item.external_item_id || existing.item_id;
          }
        } else {
          itemMap.set(key, {
            item_name: item.item_name,
            item_id: item.external_item_id || undefined,
            source: 'unified_sales',
            sales_count: 1,
            last_sold: item.sale_date,
          });
        }
      });

      // Convert to array and sort by sales count (most popular first)
      const items = Array.from(itemMap.values()).sort((a, b) => b.sales_count - a.sales_count);
      
      setPosItems(items);
    } catch (error: any) {
      console.error('Error fetching POS items:', error);
      toast({
        title: "Error fetching POS items",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [restaurantId, user, toast]);

  useEffect(() => {
    fetchPOSItems();
  }, [fetchPOSItems]);

  return {
    posItems,
    loading,
    refetch: fetchPOSItems,
  };
};