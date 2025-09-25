import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface InventoryAlert {
  id: string;
  name: string;
  current_stock: number;
  reorder_point: number;
  par_level_min: number;
  par_level_max: number;
  uom_purchase: string;
  category: string;
  supplier_name?: string;
  cost_per_unit?: number;
}

export const useInventoryAlerts = (restaurantId: string | null) => {
  const [lowStockItems, setLowStockItems] = useState<InventoryAlert[]>([]);
  const [reorderAlerts, setReorderAlerts] = useState<InventoryAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchInventoryAlerts = async () => {
    if (!restaurantId) return;

    try {
      setLoading(true);

      const { data: products, error } = await supabase
        .from('products')
        .select('*')
        .eq('restaurant_id', restaurantId);

      if (error) throw error;

      const lowStock: InventoryAlert[] = [];
      const reorderNeeded: InventoryAlert[] = [];

      (products || []).forEach(product => {
        const alert: InventoryAlert = {
          id: product.id,
          name: product.name,
          current_stock: product.current_stock || 0,
          reorder_point: product.reorder_point || 0,
          par_level_min: product.par_level_min || 0,
          par_level_max: product.par_level_max || 0,
          uom_purchase: product.uom_purchase || 'unit',
          category: product.category || 'Uncategorized',
          supplier_name: product.supplier_name,
          cost_per_unit: product.cost_per_unit
        };

        // Check if item needs reordering (current stock <= reorder point)
        if (alert.current_stock <= alert.reorder_point) {
          reorderNeeded.push(alert);
        }

        // Check if item is below minimum par level
        if (alert.current_stock < alert.par_level_min) {
          lowStock.push(alert);
        }
      });

      // Sort by urgency (lowest stock first)
      lowStock.sort((a, b) => a.current_stock - b.current_stock);
      reorderNeeded.sort((a, b) => a.current_stock - b.current_stock);

      setLowStockItems(lowStock);
      setReorderAlerts(reorderNeeded);

      // Show toast for critical alerts
      const outOfStock = reorderNeeded.filter(item => item.current_stock === 0);
      if (outOfStock.length > 0) {
        toast({
          title: `${outOfStock.length} items out of stock`,
          description: "Check the Reports page for reorder alerts",
          variant: "destructive",
        });
      }

    } catch (error: any) {
      console.error('Error fetching inventory alerts:', error);
      toast({
        title: "Error loading inventory alerts",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (restaurantId) {
      fetchInventoryAlerts();
      
      // Refresh alerts every 5 minutes
      const interval = setInterval(fetchInventoryAlerts, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [restaurantId]);

  return {
    lowStockItems,
    reorderAlerts,
    loading,
    refetch: fetchInventoryAlerts
  };
};