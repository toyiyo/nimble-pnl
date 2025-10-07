import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface InventoryAlert {
  id: string;
  name: string;
  sku?: string;
  current_stock: number;
  reorder_point: number;
  par_level_min: number;
  par_level_max: number;
  uom_purchase: string;
  size_unit?: string;
  category: string;
  supplier_name?: string;
  cost_per_unit?: number;
  image_url?: string;
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
          sku: product.sku,
          current_stock: product.current_stock || 0,
          reorder_point: product.reorder_point || 0,
          par_level_min: product.par_level_min || 0,
          par_level_max: product.par_level_max || 0,
          uom_purchase: product.uom_purchase || 'unit',
          size_unit: product.size_unit,
          category: product.category || 'Uncategorized',
          supplier_name: product.supplier_name,
          cost_per_unit: product.cost_per_unit,
          image_url: product.image_url
        };

        // Check if item needs reordering (current stock <= reorder point)
        if (alert.current_stock <= alert.reorder_point) {
          reorderNeeded.push(alert);
        }

        // Check if item is low stock:
        // 1. Out of stock (0 units)
        // 2. Below minimum par level
        // 3. Has reorder point set and stock is at or below it
        const isOutOfStock = alert.current_stock === 0;
        const isBelowParLevel = alert.par_level_min > 0 && alert.current_stock < alert.par_level_min;
        const needsReorder = alert.reorder_point > 0 && alert.current_stock <= alert.reorder_point;
        
        if (isOutOfStock || isBelowParLevel || needsReorder) {
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

  const exportLowStockCSV = () => {
    if (lowStockItems.length === 0) {
      toast({
        title: "No data to export",
        description: "There are no low stock items to export",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      'Product Name',
      'Category',
      'Current Stock',
      'Unit',
      'Reorder Point',
      'Par Level Min',
      'Par Level Max',
      'Supplier',
      'Unit Cost',
      'Total Value'
    ];

    const rows = lowStockItems.map(item => [
      item.name,
      item.category || 'Uncategorized',
      item.current_stock,
      item.uom_purchase,
      item.reorder_point,
      item.par_level_min,
      item.par_level_max,
      item.supplier_name || 'No supplier',
      item.cost_per_unit ? `$${item.cost_per_unit}` : '',
      item.cost_per_unit ? `$${(item.current_stock * item.cost_per_unit).toFixed(2)}` : ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `low-stock-alert-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast({
      title: "Export successful",
      description: `Exported ${lowStockItems.length} low stock items`,
    });
  };

  return {
    lowStockItems,
    reorderAlerts,
    loading,
    refetch: fetchInventoryAlerts,
    exportLowStockCSV
  };
};