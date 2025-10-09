import { useState, useEffect } from 'react';
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

  const fetchSuppliers = async () => {
    if (!productId || !restaurantId) {
      setSuppliers([]);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('product_suppliers')
        .select(`
          *,
          suppliers!supplier_id (
            name,
            contact_person,
            email,
            phone
          )
        `)
        .eq('product_id', productId)
        .eq('restaurant_id', restaurantId)
        .order('is_preferred', { ascending: false })
        .order('last_purchase_date', { ascending: false, nullsFirst: false });

      if (error) throw error;

      const mappedSuppliers = data?.map((ps: any) => ({
        ...ps,
        supplier_name: ps.suppliers?.name || 'Unknown Supplier',
      })) || [];

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
  };

  const setPreferredSupplier = async (productSupplierId: string) => {
    if (!restaurantId || !productId) return;

    try {
      // First, unset all preferred for this product
      await supabase
        .from('product_suppliers')
        .update({ is_preferred: false })
        .eq('product_id', productId)
        .eq('restaurant_id', restaurantId);

      // Then set the new preferred supplier
      const { error } = await supabase
        .from('product_suppliers')
        .update({ is_preferred: true })
        .eq('id', productSupplierId);

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
    try {
      const { error } = await supabase
        .from('product_suppliers')
        .delete()
        .eq('id', productSupplierId);

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
  }, [productId, restaurantId]);

  return {
    suppliers,
    loading,
    fetchSuppliers,
    setPreferredSupplier,
    removeSupplier,
  };
};
