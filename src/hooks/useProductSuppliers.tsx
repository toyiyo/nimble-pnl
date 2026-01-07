import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ProductSupplier {
  id: string;
  product_id: string;
  supplier_id: string;
  supplier_name?: string;
  supplier_sku?: string;
  last_unit_cost?: number;
  last_purchase_date?: string;
  last_purchase_quantity?: number;
  average_unit_cost?: number;
  purchase_count?: number;
  is_preferred?: boolean;
  notes?: string;
  minimum_order_quantity?: number;
  lead_time_days?: number;
  created_at?: string;
  updated_at?: string;
}

export const useProductSuppliers = (productId: string | null, restaurantId: string | null) => {
  const [suppliers, setSuppliers] = useState<ProductSupplier[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const fetchSuppliers = useCallback(async () => {
    // Skip fetch for new products (empty or missing IDs) - this is expected behavior
    if (!productId || productId === '' || !restaurantId) {
      setSuppliers([]);
      return;
    }

    console.log('[useProductSuppliers] Fetching suppliers for:', { productId, restaurantId });
    setLoading(true);
    try {
      // Fetch product suppliers
      const { data: psData, error: psError } = await supabase
        .from('product_suppliers')
        .select('*')
        .eq('product_id', productId)
        .eq('restaurant_id', restaurantId)
        .order('is_preferred', { ascending: false })
        .order('last_purchase_date', { ascending: false, nullsFirst: false });

      console.log('[useProductSuppliers] Product suppliers data:', { psData, psError });

      if (psError) throw psError;

      if (!psData || psData.length === 0) {
        console.log('[useProductSuppliers] No product suppliers found');
        setSuppliers([]);
        return;
      }

      // Get unique supplier IDs
      const supplierIds = [...new Set(psData.map(ps => ps.supplier_id))];
      console.log('[useProductSuppliers] Supplier IDs:', supplierIds);

      // Fetch supplier details
      const { data: suppliersData, error: suppliersError } = await supabase
        .from('suppliers')
        .select('id, name, contact_email, contact_phone')
        .in('id', supplierIds);

      console.log('[useProductSuppliers] Suppliers data:', { suppliersData, suppliersError });

      if (suppliersError) throw suppliersError;

      // Map suppliers by ID for easy lookup
      const suppliersMap = new Map(
        (suppliersData || []).map(s => [s.id, s])
      );

      // Merge product suppliers with supplier details
      const mappedSuppliers = psData.map((ps: any) => {
        const supplier = suppliersMap.get(ps.supplier_id);
        return {
          ...ps,
          supplier_name: supplier?.name || 'Unknown Supplier',
        };
      });

      console.log('[useProductSuppliers] Final mapped suppliers:', mappedSuppliers);
      setSuppliers(mappedSuppliers);
    } catch (error) {
      console.error('Error fetching product suppliers:', error);
      toast({
        title: 'Error loading suppliers',
        description: 'Failed to load supplier information',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [productId, restaurantId, toast]);

  const setPreferredSupplier = async (productSupplierId: string) => {
    if (!restaurantId || !productId) return;

    try {
      // Use atomic database function to prevent race conditions
      const { error } = await supabase.rpc('set_preferred_product_supplier', {
        p_product_supplier_id: productSupplierId,
        p_product_id: productId,
        p_restaurant_id: restaurantId,
      });

      if (error) throw error;

      toast({
        title: 'Preferred supplier updated',
        description: 'Successfully set preferred supplier',
      });

      await fetchSuppliers();
    } catch (error) {
      console.error('Error setting preferred supplier:', error);
      toast({
        title: 'Error',
        description: 'Failed to update preferred supplier',
        variant: 'destructive',
      });
    }
  };

  const removeSupplier = async (productSupplierId: string) => {
    if (!restaurantId || !productId) {
      toast({
        title: 'Error',
        description: 'Missing restaurant or product information',
        variant: 'destructive',
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('product_suppliers')
        .delete()
        .eq('id', productSupplierId)
        .eq('restaurant_id', restaurantId)
        .eq('product_id', productId);

      if (error) throw error;

      toast({
        title: 'Supplier removed',
        description: 'Supplier has been removed from this product',
      });

      await fetchSuppliers();
    } catch (error) {
      console.error('Error removing supplier:', error);
      toast({
        title: 'Error',
        description: 'Failed to remove supplier',
        variant: 'destructive',
      });
    }
  };

  useEffect(() => {
    fetchSuppliers();
  }, [fetchSuppliers]);

  return {
    suppliers,
    loading,
    fetchSuppliers,
    setPreferredSupplier,
    removeSupplier,
  };
};
